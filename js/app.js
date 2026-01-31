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
   SW / Cache reset
========================================================= */
async function resetSWAndCacheOnce() {
  const KEY = "sw_cache_reset_done_v200"; // バージョンアップ
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
  } catch (e) { console.warn(e); }
  localStorage.setItem(KEY, "1");
  location.reload();
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./service-worker.js"); } catch (e) {}
}

/* =========================================================
   基本設定・状態管理
========================================================= */
const el = (id) => document.getElementById(id);
const MAX_ROWS = 9;
const WEEK_MEALS = 21;
const MEALS_PER_DAY = 3;

// NCピカ補正値
const NC_APPLE = 12;
const NC_CACAO = 5;
const NC_HONEY = 3;

let state = {
  recipeRows: [], // { rowId, cat, recipeId, meals }
};

/* =========================
   Helper functions
   ========================= */
function getIng(id) { return (window.INGREDIENTS || []).find((x) => x.id === id); }
function imgSrc(file) { return "images/" + encodeURIComponent(file); }

/* =========================================================
   UI描画・イベント
========================================================= */
function renderGrids() {
  const ex = el("excludeGrid"), rep = el("replenishGrid");
  if (!ex || !rep) return;
  ex.innerHTML = ""; rep.innerHTML = "";

  (window.INGREDIENTS || []).forEach((ing) => {
    ex.innerHTML += `
      <div class="tile">
        <div class="tileName">${ing.name}</div>
        <img class="icon" src="${imgSrc(ing.file)}">
        <label class="chkLabel"><input type="checkbox" class="exChk" data-iid="${ing.id}">除外</label>
      </div>`;
    rep.innerHTML += `
      <div class="tile">
        <div class="tileName">${ing.name}</div>
        <img class="icon" src="${imgSrc(ing.file)}">
        <div class="repInputRow"><input type="number" class="repQty" data-iid="${ing.id}" placeholder="0"><span>個</span></div>
      </div>`;
  });

  document.querySelectorAll(".exChk, .repQty").forEach(input => {
    input.oninput = () => calc();
  });
}

function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_ROWS) return;

  const rowId = crypto.randomUUID ? crypto.randomUUID() : "rid_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const rowData = {
    rowId,
    cat: init?.cat || "カレー・シチュー",
    recipeId: init?.recipeId || (window.RECIPES.find(r => r.cat === (init?.cat || "カレー・シチュー"))?.id),
    meals: Number(init?.meals ?? 0),
  };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;
  wrap.innerHTML = `
    <button class="removeBtn">×</button>
    <div style="flex:1;"><label>カテゴリー</label><select class="catSel emphSelect">
      <option value="カレー・シチュー">カレー・シチュー</option>
      <option value="サラダ">サラダ</option>
      <option value="デザート・ドリンク">デザート・ドリンク</option>
    </select></div>
    <div style="flex:2;"><label>料理</label><select class="recipeSel emphSelect"></select></div>
    <div style="width:65px;"><label>食数</label><select class="mealsSel emphSelect"></select></div>
    <div class="preview"></div>
  `;

  const cSel = wrap.querySelector(".catSel"), rSel = wrap.querySelector(".recipeSel"), mSel = wrap.querySelector(".mealsSel");
  cSel.value = rowData.cat;

  const updateRecipeList = () => {
    const filtered = window.RECIPES.filter(r => r.cat === cSel.value);
    rSel.innerHTML = filtered.map(r => `<option value="${r.id}">${r.name}</option>`).join("");
    rSel.value = filtered.some(r => r.id === rowData.recipeId) ? rowData.recipeId : filtered[0].id;
    updatePreview();
  };

  const updatePreview = () => {
    rowData.cat = cSel.value; rowData.recipeId = rSel.value; rowData.meals = Number(mSel.value);
    const r = window.RECIPES.find(x => x.id === rSel.value);
    if (r) {
      wrap.querySelector(".preview").innerHTML = Object.entries(r.ingredients).map(([id, q]) => {
        const ing = getIng(id);
        return `<span><img src="${imgSrc(ing.file)}" style="width:14px;height:14px;vertical-align:middle;margin-right:2px;">${q}</span>`;
      }).join("");
    }
    updateAllMealDropdowns();
    calc();
  };

  cSel.onchange = () => { rowData.recipeId = null; updateRecipeList(); };
  rSel.onchange = updatePreview;
  mSel.onchange = updatePreview;
  wrap.querySelector(".removeBtn").onclick = () => {
    state.recipeRows = state.recipeRows.filter(r => r.rowId !== rowId);
    wrap.remove(); updateAllMealDropdowns(); calc();
  };

  updateRecipeList();
  el("recipeList").appendChild(wrap);
}

function updateAllMealDropdowns() {
  const currentTotal = state.recipeRows.reduce((s, r) => s + r.meals, 0);
  el("summaryBadge").textContent = `合計 ${currentTotal}食 / 21食`;

  state.recipeRows.forEach(row => {
    const mSel = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"] .mealsSel`);
    if (!mSel) return;
    const maxAvail = 21 - (currentTotal - row.meals);
    const val = row.meals;
    mSel.innerHTML = "";
    for (let i = 0; i <= 21; i++) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = i;
      if (i > maxAvail) opt.disabled = true;
      mSel.appendChild(opt);
    }
    mSel.value = val;
  });
  el("addRecipe").disabled = state.recipeRows.length >= MAX_ROWS;
}

/* =========================================================
   計算メインロジック
========================================================= */
function calc() {
  const exclude = new Set([...document.querySelectorAll(".exChk:checked")].map(c => c.dataset.iid));
  const perDay = new Map([...document.querySelectorAll(".repQty")].map(c => [c.dataset.iid, Number(c.value) || 0]));
  
  // NCピカ補正
  if (el("optNcPika")?.checked) {
    perDay.set("apple", (perDay.get("apple") || 0) + NC_APPLE);
    perDay.set("cacao", (perDay.get("cacao") || 0) + NC_CACAO);
    perDay.set("honey", (perDay.get("honey") || 0) + NC_HONEY);
  }

  // 1. カテゴリーごとに食材を「合算」
  const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
  state.recipeRows.forEach(row => {
    const r = window.RECIPES.find(x => x.id === row.recipeId);
    if (!r || row.meals <= 0) return;
    Object.entries(r.ingredients).forEach(([iid, qty]) => {
      catSums[row.cat].set(iid, (catSums[row.cat].get(iid) || 0) + (qty * row.meals));
    });
  });

  // 2. カテゴリー間で食材の「最大値」を採用
  const finalGross = new Map();
  Object.values(catSums).forEach(map => {
    map.forEach((total, iid) => {
      if (total > (finalGross.get(iid) || 0)) finalGross.set(iid, total);
    });
  });

  // 3. 獲得量を差し引く (獲得量 * 7日分)
  const resultGrid = el("resultGrid");
  resultGrid.innerHTML = "";
  let grandTotal = 0;

  window.INGREDIENTS.forEach(ing => {
    if (exclude.has(ing.id)) return;
    const gross = finalGross.get(ing.id) || 0;
    const subtract = (perDay.get(ing.id) || 0) * 7;
    const final = Math.max(0, gross - subtract);

    if (final > 0) {
      grandTotal += final;
      resultGrid.innerHTML += `
        <div class="tile">
          <div class="tileName">${ing.name}</div>
          <img class="icon" src="${imgSrc(ing.file)}">
          <div style="font-weight:900; font-size:13px;">${final.toLocaleString()}個</div>
        </div>`;
    }
  });
  el("totalBadge").textContent = `総合計 ${grandTotal.toLocaleString()}個`;
}

/* =========================================================
   タブ切替
========================================================= */
window.switchTab = function (tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  const target = el(tabId); if (target) target.classList.add("active");

  const navItems = document.querySelectorAll(".bottom-nav .nav-item");
  navItems.forEach(n => n.classList.remove("active"));
  if (clickedEl) { clickedEl.classList.add("active"); } 
  else {
    const idx = { tab1:0, tab2:1, tab3:2, tab4:3 }[tabId] || 0;
    if (navItems[idx]) navItems[idx].classList.add("active");
  }

  const titles = { tab1:"食材ストック計算", tab2:"出現ポケモン一覧", tab3:"経験値シミュレーター", tab4:"月齢カレンダー" };
  if (el("headerTitle")) el("headerTitle").textContent = titles[tabId] || titles.tab1;
  
  localStorage.setItem("activeTab", tabId);

  if (tabId === "tab4" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.LevelTab?.init) window.LevelTab.init();
};

/* =========================================================
   初期化
========================================================= */
window.onload = () => {
  resetSWAndCacheOnce();
  registerSW();
  renderGrids();

  el("addRecipe").onclick = () => addRecipeRow();
  el("clearAll").onclick = () => {
    el("recipeList").innerHTML = ""; state.recipeRows = [];
    document.querySelectorAll(".exChk").forEach(c => c.checked = false);
    document.querySelectorAll(".repQty").forEach(i => i.value = "");
    addRecipeRow({ meals: 0 });
    if (window.LevelTab) window.LevelTab.clearAll();
  };
  el("optNcPika").onchange = () => calc();

  // 初回行追加
  addRecipeRow({ meals: 0 });

  const savedTab = localStorage.getItem("activeTab") || "tab1";
  window.switchTab(savedTab, null);
};
