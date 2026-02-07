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
  const KEY = "sw_cache_reset_done_v107";
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
const MAX_ROWS = 12;

const NC_APPLE = 12;
const NC_CACAO = 5;
const NC_HONEY = 3;

// レシピレベルボーナス (index=レベル)
const RECIPE_LEVEL_BONUS = [
  0, // Lv0 (placeholder)
  0.00, 0.02, 0.04, 0.06, 0.08, 0.09, 0.11, 0.13, 0.16, 0.18, // Lv1-10
  0.19, 0.21, 0.23, 0.24, 0.26, 0.28, 0.30, 0.31, 0.33, 0.35, // Lv11-20
  0.37, 0.40, 0.42, 0.45, 0.47, 0.50, 0.52, 0.55, 0.58, 0.61, // Lv21-30
  0.64, 0.67, 0.70, 0.74, 0.77, 0.81, 0.84, 0.88, 0.92, 0.96, // Lv31-40
  1.00, 1.04, 1.08, 1.13, 1.17, 1.22, 1.27, 1.32, 1.37, 1.42, // Lv41-50
  1.48, 1.53, 1.59, 1.65, 1.71, 1.77, 1.83, 1.90, 1.97, 2.03, // Lv51-60
  2.09, 2.15, 2.21, 2.27, 2.34                                // Lv61-65
];

// イベントボーナスパターン
const EVENT_PATTERNS = {
  "0": { normal: 1.0, great: 2.0, sunday: 3.0 },  // なし (日曜日3倍)
  "1": { normal: 1.1, great: 2.2, sunday: 3.3 },   // パターン1
  "2": { normal: 1.25, great: 2.5, sunday: 3.75 }, // パターン2
  "3": { normal: 1.5, great: 3.0, sunday: 4.5 }    // パターン3
};

let state = {
  recipeRows: [], // { rowId, cat, recipeId, meals, level, successType }
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
   食材設定（除外 / 1日当たり獲得量） グリッド描画
========================================================= */
function renderGrids() {
  const grid = el("ingredientSettingsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  (window.INGREDIENTS || []).forEach((ing) => {
    grid.innerHTML += `
      <div class="tile" style="min-height: 110px;">
        <div class="tileName" title="${ing.name}">${ing.name}</div>
        <img class="icon" src="${imgSrc(ing.file)}" alt="">
        
        <div style="width:100%; padding:0 4px; margin-top:4px;">
           <div class="repInputRow" style="margin-bottom:4px;">
             <input type="number" class="repQty" data-iid="${ing.id}" placeholder="0" min="0" max="999">
             <span style="font-size:9px; font-weight:700; margin-left:1px;">個</span>
           </div>
           <div style="display:flex; justify-content:center;">
             <label class="chkLabel" style="background:var(--bg); border-radius:4px; padding:2px 6px;">
               <input type="checkbox" class="exChk" data-iid="${ing.id}">
               <span style="font-size:9px;">除外</span>
             </label>
           </div>
        </div>
      </div>`;
  });

  // ★修正② 入力イベントを分離し、数値の範囲制限(0-999)を追加
  document.querySelectorAll(".exChk").forEach((chk) => {
    chk.onchange = () => calc();
  });

  document.querySelectorAll(".repQty").forEach((input) => {
    input.oninput = () => {
      // マイナス値や999超えを強制補正
      if (input.value !== "") {
        let v = parseInt(input.value, 10);
        if (v < 0) v = 0;
        if (v > 999) v = 999;
        // 値が変わった場合のみ書き戻し（UXのため）
        if (String(v) !== input.value) input.value = v;
      }
      calc();
    };
  });
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
    
    // ★修正: maxAllowed から 0 に向かってループ (降順)
    for (let i = maxAllowed; i >= 0; i--) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = i;
      mSel.appendChild(opt);
    }
    
    // 現在の値が上限を超えていれば補正
    mSel.value = prevVal > maxAllowed ? maxAllowed : prevVal;
    row.meals = Number(mSel.value);
  });
  updateSummary();
}

/* =========================================================
   料理行UI
========================================================= */
function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_ROWS) return;

  const rowId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("rid_" + Date.now() + "_" + Math.random().toString(16).slice(2));
  
  // 初期食数を決定（既存の合計から引く）
  const currentTotal = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  const initialMeals = Math.min(init?.meals ?? 21, 21 - currentTotal);

  const rowData = {
    rowId,
    cat: init?.cat || "カレー・シチュー",
    recipeId: init?.recipeId || getFirstRecipeIdByCat(init?.cat || "カレー・シチュー"),
    meals: initialMeals,
    level: init?.level || 65,
    successType: init?.successType || "normal"
  };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;

  // ラジオボタンのname属性をユニークにする
  const radioName = `success_${rowId}`;

  // レシピレベルの選択肢生成（65 -> 1 の降順）
  let levelOptions = "";
  for (let i = 65; i >= 1; i--) {
    levelOptions += `<option value="${i}">${i}</option>`;
  }

  wrap.innerHTML = `
    <button class="removeBtn" title="削除">×</button>
    
    <div style="flex:1 1 120px;">
      <label class="emphLabel">カテゴリー</label>
      <select class="catSel emphSelect">
        <option value="カレー・シチュー">カレー・シチュー</option>
        <option value="サラダ">サラダ</option>
        <option value="デザート・ドリンク">デザート・ドリンク</option>
      </select>
    </div>
    <div style="flex:2 1 180px;">
      <label class="emphLabel">料理</label>
      <select class="recipeSel emphSelect"></select>
    </div>

    <div style="display:flex; gap:8px; width:100%; flex-wrap:wrap; align-items:flex-end;">
        <div style="width:60px;">
          <label class="emphLabel">食数</label>
          <select class="mealsSel emphSelect"></select>
        </div>
        
        <div style="width:60px;">
          <label class="emphLabel">レシピLv</label>
          <select class="lvlInput" style="text-align:center; height:38px; border:1px solid var(--line); border-radius:10px; background:#fff; font-weight:800;">
            ${levelOptions}
          </select>
        </div>

        <div style="flex:1; min-width:160px;">
          <label class="emphLabel">大成功</label>
          <div class="radioGroup" style="height:38px; align-items:center;">
             <label><input type="radio" name="${radioName}" value="normal" checked>なし</label>
             <label><input type="radio" name="${radioName}" value="great">大成功</label>
             <label><input type="radio" name="${radioName}" value="sunday">日曜大成功</label>
          </div>
        </div>
    </div>

    <div class="preview"></div>
  `;

  const cSel = wrap.querySelector(".catSel");
  const rSel = wrap.querySelector(".recipeSel");
  const mSel = wrap.querySelector(".mealsSel");
  const lSel = wrap.querySelector(".lvlInput");
  const radios = wrap.querySelectorAll(`input[name="${radioName}"]`);
  const pre = wrap.querySelector(".preview");

  cSel.value = rowData.cat;
  lSel.value = rowData.level;

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
    rowData.level = Number(lSel.value) || 1;
    rowData.successType = wrap.querySelector(`input[name="${radioName}"]:checked`).value;

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
  
  // ★GAイベント追加：料理を選んだ瞬間に送信
  rSel.onchange = () => {
    const selectedText = rSel.options[rSel.selectedIndex]?.text || rSel.value;
    if (typeof gtag === 'function') {
      gtag('event', 'select_recipe', {
        'recipe_name': selectedText,
        'category': cSel.value
      });
    }
    updatePreview();
  };

  mSel.onchange = () => {
    rowData.meals = Number(mSel.value);
    refreshAllMealDropdowns(); 
    updatePreview();
  };
  
  lSel.onchange = () => {
    rowData.level = Number(lSel.value);
    calc();
  };

  radios.forEach(ra => ra.onchange = updatePreview);

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
   計算ロジック（エナジー計算 ＆ ストック計算）
========================================================= */
function buildReplenishPerDayMap() {
  const map = new Map([...document.querySelectorAll(".repQty")].map(c => [c.dataset.iid, Number(c.value) || 0]));
  if (el("optNcPika")?.checked) {
    map.set("apple", (map.get("apple") || 0) + NC_APPLE);
    map.set("cacao", (map.get("cacao") || 0) + NC_CACAO);
    map.set("honey", (map.get("honey") || 0) + NC_HONEY);
  }
  return map;
}

function buildExcludeSet() {
  return new Set([...document.querySelectorAll(".exChk:checked")].map(c => c.dataset.iid));
}

function calc() {
  const exclude = buildExcludeSet();
  const perDay = buildReplenishPerDayMap();
  const resultGrid = el("resultGrid");
  
  // ▼ エナジー計算用の設定読み込み
  const fbVal = Number(el("fieldBonusSel")?.value || 0);
  const fbMul = 1 + (fbVal / 100);
  const evPatKey = el("eventBonusSel")?.value || "0";
  const evPattern = EVENT_PATTERNS[evPatKey];

  // 1. カテゴリー別に食材を合算 & エナジー計算
  const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
  const ingredientOrder = [];
  let totalEnergy = 0;

  state.recipeRows.forEach(row => {
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r || row.meals <= 0) return;

    // --- エナジー計算 ---
    // レシピ基本エナジー (レシピ定義の baseEnergy を使用)
    const baseEnergy = r.baseEnergy;
    // レシピレベルボーナス分 = Round[ (レシピ基本エナジー)×(レシピレベルボーナス) ]
    const lv = Math.max(1, Math.min(65, row.level || 1));
    const bonusPct = RECIPE_LEVEL_BONUS[lv];
    const lvBonusVal = Math.round(baseEnergy * bonusPct);
    
    // レシピ画面の表示エナジー
    const displayEnergy = baseEnergy + lvBonusVal;

    // 最終エナジー = (レシピ画面の表示エナジー + 追加食材(0))×(1+FB)×(イベント)
    // イベント補正
    let evMul = 1.0;
    if (row.successType === "great") evMul = evPattern.great;
    else if (row.successType === "sunday") evMul = evPattern.sunday;
    else evMul = evPattern.normal;

    // 1食あたりの最終エナジー
    const oneMealEnergy = Math.floor(displayEnergy * fbMul * evMul);
    
    // 合計加算
    totalEnergy += (oneMealEnergy * row.meals);

    // --- ストック計算用の食材集計 ---
    const map = catSums[row.cat];
    Object.entries(r.ingredients).forEach(([iid, qty]) => {
      if (!ingredientOrder.includes(iid)) ingredientOrder.push(iid);
      map.set(iid, (map.get(iid) || 0) + (qty * row.meals));
    });
  });

  // エナジー結果表示
  const energyRes = el("energyResultVal");
  if (energyRes) energyRes.textContent = totalEnergy.toLocaleString();

  if (!resultGrid) return;

  // 2. ストック計算：カテゴリー間で最大値を採用
  const gross = new Map();
  Object.values(catSums).forEach(map => {
    map.forEach((val, iid) => {
      gross.set(iid, Math.max(gross.get(iid) || 0, val));
    });
  });

  // 3. ストック描画
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

  // 総合計バッジ
  const totalBadge = el("totalBadge");
  if (totalBadge) totalBadge.textContent = `総合計 ${grandTotal}個`;

  // カテゴリー混在時の注釈
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
  renderGrids(); // 統合グリッドを描画

  // グローバル設定のイベントリスナー追加
  el("fieldBonusSel")?.addEventListener("change", calc);
  el("eventBonusSel")?.addEventListener("change", calc);

  el("optNcPika")?.addEventListener("change", () => calc());
  el("addRecipe").onclick = () => addRecipeRow();
  el("clearAll").onclick = () => {
    el("recipeList").innerHTML = "";
    state.recipeRows = [];
    document.querySelectorAll(".exChk").forEach(c => c.checked = false);
    document.querySelectorAll(".repQty").forEach(i => i.value = "");
    addRecipeRow({ meals: 21 });
  };

  if (state.recipeRows.length === 0) addRecipeRow({ meals: 21 });

  const savedTab = localStorage.getItem("activeTab") || "tab1";
  switchTab(savedTab);

  // モーダル
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

  el("headerTitle").textContent = { tab1: "料理計算", tab2: "出現ポケモン一覧", tab3: "経験値シミュレーター", tab4: "月齢カレンダー" }[tabId];
  localStorage.setItem("activeTab", tabId);

  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.LevelTab?.init) window.LevelTab.init();
  if (tabId === "tab4" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
};

/* =========================================================
   簡易メッセージモーダル表示 (alertの代用)
========================================================= */
window.showInfo = function(msg) {
  const modal = document.getElementById("simpleModal");
  const msgBox = document.getElementById("simpleModalMsg");
  if (modal && msgBox) {
    msgBox.innerHTML = msg.replace(/\n/g, "<br>"); // 改行対応
    modal.style.display = "flex";
  } else {
    // 万が一HTMLがない場合は通常のalertで代用
    alert(msg);
  }
};

/* =========================================================
   資料ビューア
========================================================= */
window.openDoc = function(fileName) {
  const modal = document.getElementById("docViewerModal");
  const img = document.getElementById("docViewerImg");
  if (modal && img) {
    img.src = "images/" + fileName;
    modal.style.display = "flex";
  }
};
