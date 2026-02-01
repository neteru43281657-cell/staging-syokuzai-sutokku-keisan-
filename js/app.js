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
  const KEY = "sw_cache_reset_done_v106";
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

let state = {
  recipeRows: [], // { rowId, cat, recipeId, meals }
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
   除外 / 1日当たり獲得量 グリッド描画
========================================================= */
function renderGrids() {
  const ex = el("excludeGrid"), rep = el("replenishGrid");
  if (!ex || !rep) return;

  ex.innerHTML = "";
  rep.innerHTML = "";

  (window.INGREDIENTS || []).forEach((ing) => {
    ex.innerHTML += `
      <div class="tile">
        <div class="tileName" title="${ing.name}">${ing.name}</div>
        <img class="icon" src="${imgSrc(ing.file)}" alt="">
        <div class="exInputRow" style="width:100%; display:flex; justify-content:center; align-items:center;">
          <label class="chkLabel"><input type="checkbox" class="exChk" data-iid="${ing.id}">除外</label>
        </div>
      </div>`;

    rep.innerHTML += `
      <div class="tile">
        <div class="tileName" title="${ing.name}">${ing.name}</div>
        <img class="icon" src="${imgSrc(ing.file)}" alt="">
        <div class="repInputRow" style="padding: 0 8px;">
          <input type="number" class="repQty" data-iid="${ing.id}" placeholder="0">
          <span style="font-size:9px; font-weight:700; margin-left:1px;">個</span>
        </div>
      </div>`;
  });

  document.querySelectorAll(".exChk, .repQty").forEach((input) => {
    input.oninput = () => calc();
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
    for (let i = 0; i <= maxAllowed; i++) {
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
  };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;

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
    <div class="preview"></div>
  `;

  const cSel = wrap.querySelector(".catSel");
  const rSel = wrap.querySelector(".recipeSel");
  const mSel = wrap.querySelector(".mealsSel");
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
    refreshAllMealDropdowns(); // 他の行の選択肢を同期
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
  refreshAllMealDropdowns(); // 追加時に全体を同期
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
  if (!resultGrid) return;

  // 1. カテゴリー別に食材を合算
  const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
  // ② レシピの並び順を保持するための配列
  const ingredientOrder = [];

  state.recipeRows.forEach(row => {
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r || row.meals <= 0) return;
    const map = catSums[row.cat];
    Object.entries(r.ingredients).forEach(([iid, qty]) => {
      // 出現した順番に ID を記録（重複は避ける）
      if (!ingredientOrder.includes(iid)) ingredientOrder.push(iid);
      map.set(iid, (map.get(iid) || 0) + (qty * row.meals));
    });
  });

  // 2. カテゴリー間で最大値を採用
  const gross = new Map();
  Object.values(catSums).forEach(map => {
    map.forEach((val, iid) => {
      gross.set(iid, Math.max(gross.get(iid) || 0, val));
    });
  });

  // 3. 描画（レシピの登録順 ingredientOrder に基づいてループ）
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

  // ① 総合計バッジの更新
  const totalBadge = el("totalBadge");
  if (totalBadge) totalBadge.textContent = `総合計 ${grandTotal}個`;

  // ▼▼▼ 追加：カテゴリー混在時の注釈表示制御 ▼▼▼
  const note = el("mode3Note");
  if (note) {
    // 現在登録されているレシピのカテゴリー（重複なし）を取得
    const activeCats = new Set(state.recipeRows.map(r => r.cat));
    // 2種類以上ある場合のみ表示
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

  el("headerTitle").textContent = { tab1: "食材ストック計算", tab2: "出現ポケモン一覧", tab3: "経験値シミュレーター", tab4: "月齢カレンダー" }[tabId];
  localStorage.setItem("activeTab", tabId);

  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.LevelTab?.init) window.LevelTab.init();
  if (tabId === "tab4" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
};
