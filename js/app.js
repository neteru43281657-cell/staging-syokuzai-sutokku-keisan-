"use strict";

/* =========================================================
   診断モード：JSエラーを画面に表示
========================================================= */
(function attachErrorOverlay() {
  function ensureBox() {
    let box = document.getElementById("jsErrorOverlay");
    if (!box) {
      box = document.createElement("div");
      box.id = "jsErrorOverlay";
      box.style.cssText = `
        position: fixed; left: 10px; right: 10px; bottom: 70px;
        z-index: 99999; background: #fff; border: 2px solid #d00;
        border-radius: 12px; padding: 10px; font-size: 12px;
        color: #111; box-shadow: 0 6px 20px rgba(0,0,0,.2);
        display: none; white-space: pre-wrap; line-height: 1.4;
      `;
      document.body.appendChild(box);
    }
    return box;
  }
  function show(msg) {
    try {
      const box = ensureBox();
      box.textContent = msg;
      box.style.display = "block";
    } catch (_) {}
  }
  window.addEventListener("error", (e) => {
    const msg = ["[JS Error]", e.message || "(no message)", `@ ${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`].join("\n");
    show(msg);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason && (e.reason.stack || e.reason.message || String(e.reason));
    show(["[Unhandled Promise Rejection]", reason || "(no reason)"].join("\n"));
  });
  window.__APP_JS_LOADED__ = true;
})();

/* =========================================================
   SW / Cache reset (一回だけ)
========================================================= */
async function resetSWAndCacheOnce() {
  const KEY = "sw_cache_reset_done_v110"; // verup
  if (localStorage.getItem(KEY)) return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("resetSWAndCacheOnce failed:", e);
  }
  localStorage.setItem(KEY, "1");
  location.reload();
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (e) {
    console.warn("SW register failed:", e);
  }
}

/* =========================================================
   基本定数・状態管理
========================================================= */
const el = (id) => document.getElementById(id);

const MEALS_PER_DAY = 3;
const WEEK_DAYS = 7;
const WEEK_MEALS = 21;
const MAX_ROWS = 9; 

const NC_APPLE = 12;
const NC_CACAO = 5;
const NC_HONEY = 3;

// レシピレベルボーナス (index=レベル)
// Lv1=0%, Lv2=2% ... Lv65=234%
const RECIPE_LV_BONUS = [
  0, 0, 0.02, 0.04, 0.06, 0.08, 0.09, 0.11, 0.13, 0.16, 0.18,
  0.19, 0.21, 0.23, 0.24, 0.26, 0.28, 0.30, 0.31, 0.33, 0.35,
  0.37, 0.40, 0.42, 0.45, 0.47, 0.50, 0.52, 0.55, 0.58, 0.61,
  0.64, 0.67, 0.70, 0.74, 0.77, 0.81, 0.84, 0.88, 0.92, 0.96,
  1.00, 1.04, 1.08, 1.13, 1.17, 1.22, 1.27, 1.32, 1.37, 1.42,
  1.48, 1.53, 1.59, 1.65, 1.71, 1.77, 1.83, 1.90, 1.97, 2.03,
  2.09, 2.15, 2.21, 2.27, 2.34
];

// フィールドボーナス (0, 5, ..., 100)
const FIELD_BONUS_STEPS = [];
for(let i=0; i<=100; i+=5) FIELD_BONUS_STEPS.push(i);

let state = {
  recipeRows: [], // { rowId, cat, recipeId, meals, level }
};

/* =========================================================
   Helpers
========================================================= */
function getIng(id) {
  return (window.INGREDIENTS || []).find((x) => x.id === id);
}

function imgSrc(file) {
  return "images/" + encodeURIComponent(file || "");
}

function getFirstRecipeIdByCat(cat) {
  const first = (window.RECIPES || []).find((r) => r.cat === cat);
  return first ? first.id : null;
}

/* =========================================================
   グリッド描画（統合版）
   除外ChkとReplenishInputを1つのタイルにする
========================================================= */
function renderGrids() {
  const container = el("mergedIngGrid");
  if (!container) return;
  container.innerHTML = "";

  (window.INGREDIENTS || []).forEach((ing) => {
    container.innerHTML += `
      <div class="merged-tile">
        <div class="merged-tile-head">
          <img class="merged-tile-icon" src="${imgSrc(ing.file)}" alt="">
          <div class="merged-tile-name" title="${ing.name}">${ing.name}</div>
        </div>
        
        <div class="merged-tile-ctrl">
          <label class="merged-ex-label">
            <input type="checkbox" class="merged-ex-chk" data-iid="${ing.id}">
            除外
          </label>
          <div class="merged-rep-row">
            <input type="number" class="merged-rep-input" data-iid="${ing.id}" placeholder="0">
            <span class="merged-rep-unit">個/日</span>
          </div>
        </div>
      </div>`;
  });

  document.querySelectorAll(".merged-ex-chk, .merged-rep-input").forEach((input) => {
    input.oninput = () => calc();
  });
}

/* =========================================================
   設定UI（フィールドボーナス等）
========================================================= */
function renderConfigUI() {
  // フィールドボーナス生成
  const fbSel = el("fieldBonusSel");
  if (fbSel) {
    fbSel.innerHTML = FIELD_BONUS_STEPS.map(v => `<option value="${v}">${v}%</option>`).join("");
    // デフォルト60%くらいにしておく（適当）
    fbSel.value = "0"; 
  }
  
  // イベントはHTML直書きだが、リスナー設定
  el("fieldBonusSel")?.addEventListener("change", calc);
  el("eventBonusSel")?.addEventListener("change", calc);
  document.querySelectorAll('input[name="evSit"]').forEach(r => r.addEventListener("change", calc));
}

/* =========================================================
   食数ドロップダウンの同期
========================================================= */
function refreshAllMealDropdowns() {
  state.recipeRows.forEach(row => {
    const wrap = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"]`);
    if (!wrap) return;
    const mSel = wrap.querySelector(".mealsSel");
    if (!mSel) return;

    const currentVal = row.meals;
    const otherTotal = state.recipeRows
      .filter(r => r.rowId !== row.rowId)
      .reduce((sum, r) => sum + r.meals, 0);
    const maxAllowed = Math.max(0, 21 - otherTotal);

    const prevVal = mSel.value;
    mSel.innerHTML = "";
    for (let i = 0; i <= maxAllowed; i++) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = i;
      mSel.appendChild(opt);
    }
    mSel.value = prevVal > maxAllowed ? maxAllowed : prevVal;
    row.meals = Number(mSel.value);
  });
  updateSummary();
}

/* =========================================================
   料理行UI
   (Recipe Level入力を追加)
========================================================= */
function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_ROWS) return;

  const rowId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("rid_" + Date.now() + "_" + Math.random().toString(16).slice(2));
  const currentTotal = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  const initialMeals = Math.min(init?.meals ?? 21, 21 - currentTotal);

  const rowData = {
    rowId,
    cat: init?.cat || "カレー・シチュー",
    recipeId: init?.recipeId || getFirstRecipeIdByCat(init?.cat || "カレー・シチュー"),
    meals: initialMeals,
    level: init?.level || 1
  };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;

  // レシピレベル入力欄を追加
  wrap.innerHTML = `
    <button class="removeBtn" title="削除">×</button>
    <div style="flex:1; min-width:100px;">
      <label class="emphLabel">カテゴリー</label>
      <select class="catSel emphSelect">
        <option value="カレー・シチュー">カレー・シチュー</option>
        <option value="サラダ">サラダ</option>
        <option value="デザート・ドリンク">デザート・ドリンク</option>
      </select>
    </div>
    <div style="flex:2; min-width:140px;">
      <label class="emphLabel">料理</label>
      <select class="recipeSel emphSelect"></select>
    </div>
    <div style="width:60px;">
      <label class="emphLabel">食数</label>
      <select class="mealsSel emphSelect"></select>
    </div>
    <div style="width:50px; display:flex; flex-direction:column; align-items:center;">
      <label class="emphLabel">Lv.</label>
      <input type="number" class="recipeLvInput" min="1" max="65" value="${rowData.level}">
    </div>
    <div class="preview"></div>
  `;

  const cSel = wrap.querySelector(".catSel");
  const rSel = wrap.querySelector(".recipeSel");
  const mSel = wrap.querySelector(".mealsSel");
  const lIn = wrap.querySelector(".recipeLvInput");
  const pre = wrap.querySelector(".preview");

  cSel.value = rowData.cat;

  const updateRecipeList = () => {
    const filtered = RECIPES.filter((r) => r.cat === cSel.value);
    rSel.innerHTML = filtered.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
    rSel.value = filtered.some(r => r.id === rowData.recipeId) ? rowData.recipeId : (filtered[0]?.id || "");
    updatePreview();
  };

  const updatePreview = () => {
    rowData.cat = cSel.value;
    rowData.recipeId = rSel.value;
    rowData.meals = Number(mSel.value);
    
    // Levelバリデーション
    let lv = parseInt(lIn.value, 10);
    if(isNaN(lv) || lv < 1) lv = 1;
    if(lv > 65) lv = 65;
    rowData.level = lv;
    // UI上の値を強制補正しない（入力中の利便性のため）が、計算には補正値を使う
    
    const r = RECIPES.find((x) => x.id === rSel.value);
    if (r) {
      const totalIngredients = Object.values(r.ingredients).reduce((sum, c) => sum + c, 0);
      let html = Object.entries(r.ingredients).map(([id, q]) => {
        const ing = getIng(id);
        return `<span><img src="${imgSrc(ing?.file)}" style="width:14px; height:14px; margin-right:4px; vertical-align:middle;">${q}</span>`;
      }).join("");
      html += `<span class="badge" style="margin-left: auto; background:var(--main-soft); color:var(--main); border:1px solid #cce5ff; padding: 2px 10px; font-size: 11px;">${totalIngredients}個</span>`;
      pre.innerHTML = html;
    }
    calc();
  };

  cSel.onchange = updateRecipeList;
  rSel.onchange = updatePreview;
  mSel.onchange = () => {
    rowData.meals = Number(mSel.value);
    refreshAllMealDropdowns(); 
    updatePreview();
  };
  lIn.oninput = () => {
    updatePreview();
  };

  wrap.querySelector(".removeBtn").onclick = () => {
    state.recipeRows = state.recipeRows.filter((r) => r.rowId !== rowId);
    wrap.remove();
    refreshAllMealDropdowns();
    calc();
  };

  updateRecipeList();
  el("recipeList").appendChild(wrap);
  refreshAllMealDropdowns();
}

function updateSummary() {
  const totalMeals = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  const badge = el("summaryBadge");
  if (badge) badge.textContent = `${totalMeals}食 / 21食`;
  
  const addBtn = el("addRecipe");
  if (addBtn) addBtn.disabled = state.recipeRows.length >= MAX_ROWS;
}

/* =========================================================
   計算ロジック
========================================================= */
function buildReplenishPerDayMap() {
  // 統合されたInputから取得
  const map = new Map([...document.querySelectorAll(".merged-rep-input")].map(c => [c.dataset.iid, Number(c.value) || 0]));
  if (el("optNcPika")?.checked) {
    map.set("apple", (map.get("apple") || 0) + NC_APPLE);
    map.set("cacao", (map.get("cacao") || 0) + NC_CACAO);
    map.set("honey", (map.get("honey") || 0) + NC_HONEY);
  }
  return map;
}

function buildExcludeSet() {
  // 統合されたCheckboxから取得
  return new Set([...document.querySelectorAll(".merged-ex-chk:checked")].map(c => c.dataset.iid));
}

// エナジー計算
function calcEnergy() {
  const fbVal = Number(el("fieldBonusSel")?.value || 0);
  const evBaseStr = el("eventBonusSel")?.value || "1.0";
  const evSit = document.querySelector('input[name="evSit"]:checked')?.value || "normal";
  
  // イベント倍率連動
  // 平日(1.1) -> 大成功(2.2), 日曜(3.3)
  // 小(1.25) -> 大成功(2.5), 日曜(3.75)
  // 大(1.5) -> 大成功(3.0), 日曜(4.5)
  // なし(1.0) -> 大成功(2.0), 日曜(1.0??) →仕様がないので通常通りとするが、ここでは「等倍」ベースで考える
  
  let baseMul = parseFloat(evBaseStr);
  let finalEvMul = baseMul; // default normal

  if (evSit === "extra") {
    // 大成功はベースの2倍（平日1.1なら2.2）
    // ただし「なし(1.0)」の場合は大成功2倍ルールを適用
    finalEvMul = baseMul * 2.0;
  } else if (evSit === "sunday") {
    // 日曜はベースの3倍（平日1.1なら3.3）
    // ただし「なし(1.0)」の場合、日曜鍋拡張はあるが倍率は1.0のまま等の解釈があるが、
    // ここではユーザの指定意図(平日/小/大)に沿って3倍する
    finalEvMul = baseMul * 3.0;
  }
  
  // レシピごとの計算
  let totalEnergy = 0;
  
  state.recipeRows.forEach(row => {
    if (row.meals <= 0) return;
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r) return;
    
    // 1. レシピ基本エナジー (r.baseEnergy)
    const base = r.baseEnergy || 0;
    
    // 2. レシピレベルボーナス
    // レベルは1~65
    let lv = row.level || 1;
    if(lv < 1) lv = 1; if(lv > 65) lv = 65;
    const bonusPct = RECIPE_LV_BONUS[lv] || 0;
    
    const bonusVal = Math.round(base * bonusPct);
    const recipeScreenEnergy = base + bonusVal;
    
    // 3. 追加食材 (Filler)
    // 今回のUIにはFiller入力がないので 0 とする
    const fillerEnergy = 0;
    
    // 4. 最終計算
    // (レシピ画面表示 + 追加食材) * FB * イベント
    const withFB = recipeScreenEnergy * (1 + fbVal / 100);
    const withEvent = withFB * finalEvMul;
    
    // 切り捨て
    const finalPerMeal = Math.floor(withEvent);
    
    totalEnergy += finalPerMeal * row.meals;
  });
  
  const resVal = el("energyResultVal");
  const resDesc = el("energyResultDesc");
  
  if (resVal) {
    resVal.textContent = totalEnergy.toLocaleString();
    let desc = `FB:${fbVal}% / イベント:x${finalEvMul.toFixed(2)}`;
    if(state.recipeRows.length === 0) desc = "レシピを追加してください";
    resDesc.textContent = desc;
  }
}

function calc() {
  // ストック計算
  const exclude = buildExcludeSet();
  const perDay = buildReplenishPerDayMap();
  const resultGrid = el("resultGrid");
  
  // エナジー計算も実行
  calcEnergy();

  if (!resultGrid) return;

  const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
  const ingredientOrder = [];

  state.recipeRows.forEach(row => {
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r || row.meals <= 0) return;
    const map = catSums[row.cat];
    Object.entries(r.ingredients).forEach(([iid, qty]) => {
      if (!ingredientOrder.includes(iid)) ingredientOrder.push(iid);
      map.set(iid, (map.get(iid) || 0) + (qty * row.meals));
    });
  });

  const gross = new Map();
  Object.values(catSums).forEach(map => {
    map.forEach((val, iid) => {
      gross.set(iid, Math.max(gross.get(iid) || 0, val));
    });
  });

  resultGrid.innerHTML = "";
  let grandTotal = 0;

  ingredientOrder.forEach(iid => {
    if (exclude.has(iid)) return;
    const g = gross.get(iid) || 0;
    const finalNeed = Math.max(0, Math.round(g - ((perDay.get(iid) || 0) * 7)));

    if (finalNeed <= 0) return;
    grandTotal += finalNeed;
    const ing = getIng(iid);
    resultGrid.innerHTML += `
      <div class="tile">
        <div class="tileName">${ing?.name}</div>
        <img class="icon" src="${imgSrc(ing?.file)}">
        <div style="font-weight:900; font-size:13px;">${finalNeed}個</div>
      </div>`;
  });

  const totalBadge = el("totalBadge");
  if (totalBadge) totalBadge.textContent = `総合計 ${grandTotal}個`;

  const note = el("mode3Note");
  if (note) {
    const activeCats = new Set(state.recipeRows.map(r => r.cat));
    note.style.display = (activeCats.size > 1) ? "block" : "none";
  }
}


/* =========================================================
   onload / タブ切替
========================================================= */
window.onload = () => {
  resetSWAndCacheOnce();
  registerSW();
  renderGrids();
  renderConfigUI();

  el("optNcPika")?.addEventListener("change", () => calc());
  el("addRecipe").onclick = () => addRecipeRow();
  el("clearAll").onclick = () => {
    el("recipeList").innerHTML = "";
    state.recipeRows = [];
    document.querySelectorAll(".merged-ex-chk").forEach(c => c.checked = false);
    document.querySelectorAll(".merged-rep-input").forEach(i => i.value = "");
    // Default reset for bonus
    if(el("fieldBonusSel")) el("fieldBonusSel").value = "0";
    if(el("eventBonusSel")) el("eventBonusSel").value = "1.0";
    
    addRecipeRow({ meals: 21 });
  };

  if (state.recipeRows.length === 0) addRecipeRow({ meals: 21 });

  const savedTab = localStorage.getItem("activeTab") || "tab1";
  switchTab(savedTab);

  const dM = el("docsModal"), nM = el("noticeModal"), vM = el("docViewerModal");
  el("openDocs").onclick = () => dM.style.display = "flex";
  el("closeDocs").onclick = () => dM.style.display = "none";
  el("openNotice").onclick = () => nM.style.display = "flex";
  el("closeNotice").onclick = () => nM.style.display = "none";
  el("closeDocViewer").onclick = () => vM.style.display = "none";
};

window.switchTab = function (tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  el(tabId)?.classList.add("active");

  const items = document.querySelectorAll(".bottom-nav .nav-item");
  items.forEach(n => n.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");
  else {
    const idx = { tab1: 0, tab2: 1, tab3: 2, tab4: 3 }[tabId] || 0;
    items[idx]?.classList.add("active");
  }

  el("headerTitle").textContent = { tab1: "食材ストック計算", tab2: "出現ポケモン一覧", tab3: "経験値シミュ", tab4: "月齢カレンダー" }[tabId];
  localStorage.setItem("activeTab", tabId);

  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.LevelTab?.init) window.LevelTab.init();
  if (tabId === "tab4" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
};

window.showInfo = function(msg) {
  const modal = document.getElementById("simpleModal");
  const msgBox = document.getElementById("simpleModalMsg");
  if (modal && msgBox) {
    msgBox.innerHTML = msg.replace(/\n/g, "<br>");
    modal.style.display = "flex";
  } else {
    alert(msg);
  }
};

window.openDoc = function(fileName) {
  const modal = document.getElementById("docViewerModal");
  const img = document.getElementById("docViewerImg");
  if (modal && img) {
    img.src = "images/" + fileName;
    modal.style.display = "flex";
  }
};
