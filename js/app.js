// app.js
"use strict";

// ===== 診断モード：JSエラーを画面に表示 =====
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
    const msg = [
      "[JS Error]",
      e.message || "(no message)",
      `@ ${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`,
    ].join("\n");
    show(msg);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason && (e.reason.stack || e.reason.message || String(e.reason));
    show(["[Unhandled Promise Rejection]", reason || "(no reason)"].join("\n"));
  });

  // app.js が読み込めているかの目印
  window.__APP_JS_LOADED__ = true;
})();


// ★一度だけ：古いService Worker & Cacheを全削除してリロード
async function resetSWAndCacheOnce() {
  const KEY = "sw_cache_reset_done_v111";
  if (localStorage.getItem(KEY)) return;

  try {
    // unregister service workers
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // delete all caches
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    // 失敗しても致命的ではないので握りつぶし
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

const el = (id) => document.getElementById(id);

let state = { recipeRows: [] };


const MEALS_PER_DAY = 3;
const MAX_RECIPE_ROWS = 9;
const MAX_TOTAL_MEALS = 21;

function getIng(id) { return INGREDIENTS.find(x => x.id === id); }

function imgSrc(file) { return "images/" + encodeURIComponent(file); }

function switchTab(tabId, clickedEl) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');

  if (clickedEl) {
    clickedEl.classList.add('active');
  } else {
    const targetNav = Array.from(document.querySelectorAll('.nav-item')).find(n => n.getAttribute('onclick').includes(tabId));
    if (targetNav) targetNav.classList.add('active');
  }

  localStorage.setItem('activeTab', tabId);
  const headerTitle = el('headerTitle');
  const headerVer = el('headerVer');

  if (tabId === 'tab1') {
    headerTitle.textContent = '食材ストック計算';
    headerVer.textContent = 'ver1.0.3';
  } else if (tabId === 'tab2') {
    headerTitle.textContent = '出現ポケモン一覧';
    headerVer.textContent = 'ver1.0.3';
  } else if (tabId === 'tab3') {
    headerTitle.textContent = '2026年 月齢カレンダー';
    headerVer.textContent = 'ver1.0.3';
  }
  window.scrollTo(0, 0);
}

function renderGrids() {
  const ex = el("excludeGrid"), rep = el("replenishGrid");
  ex.innerHTML = ""; rep.innerHTML = "";
  INGREDIENTS.forEach(ing => {
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
  document.querySelectorAll(".exChk, .repQty").forEach(input => {
    input.oninput = (e) => {
      if (e.target.classList.contains("repQty")) {
        if (e.target.value > 999) e.target.value = 999;
        if (e.target.value < 0) e.target.value = 0;
      }
      calc();
    };
  });
}

function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_RECIPE_ROWS) return;
  const rowId = crypto.randomUUID();
  const rowData = { rowId, cat: init?.cat || "カレー・シチュー", recipeId: init?.recipeId || "avocado_gratin", meals: init?.meals || 0 };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;
  wrap.innerHTML = `
    <button class="removeBtn" title="削除">×</button>
    <div style="flex:1; min-width:100px;">
      <label>カテゴリー</label>
      <select class="catSel">
        <option value="カレー・シチュー">カレー・シチュー</option>
        <option value="サラダ">サラダ</option>
        <option value="デザート・ドリンク">デザート・ドリンク</option>
      </select>
    </div>
    <div style="flex:2; min-width:140px;">
      <label>料理</label>
      <select class="recipeSel"></select>
    </div>
    <div style="width:60px;">
      <label>食数</label>
      <select class="mealsSel"></select>
    </div>
    <div class="preview"></div>`;

  const cSel = wrap.querySelector(".catSel"), rSel = wrap.querySelector(".recipeSel"), mSel = wrap.querySelector(".mealsSel"), pre = wrap.querySelector(".preview");

  const updateRecipeList = () => {
    const filtered = RECIPES.filter(r => r.cat === cSel.value);
    rSel.innerHTML = filtered.map(r => `<option value="${r.id}">${r.name}</option>`).join("");
    if (filtered.some(r => r.id === rowData.recipeId)) rSel.value = rowData.recipeId;
    else rowData.recipeId = rSel.value;
    updatePreview();
  };

  const updatePreview = () => {
    rowData.cat = cSel.value; 
    rowData.recipeId = rSel.value; 
    rowData.meals = Number(mSel.value);
    
    const r = RECIPES.find(x => x.id === rSel.value);
    if (r) {
      const totalIngredients = Object.values(r.ingredients).reduce((sum, count) => sum + count, 0);
      let html = Object.entries(r.ingredients).map(([id, q]) => {
        const ing = getIng(id);
        return `<span><img src="${imgSrc(ing.file)}" style="width:14px; height:14px; margin-right:4px; vertical-align:middle;">${q}</span>`;
      }).join("");
      html += `<span class="badge" style="margin-left: auto; background:var(--main-soft); color:var(--main); border:1px solid #cce5ff; padding: 2px 10px; font-size: 11px;">${totalIngredients}個</span>`;
      pre.innerHTML = html;
    }
    updateAllMealDropdowns();
    calc();
  };

  cSel.onchange = updateRecipeList; rSel.onchange = updatePreview; mSel.onchange = updatePreview;
  wrap.querySelector(".removeBtn").onclick = () => {
    state.recipeRows = state.recipeRows.filter(r => r.rowId !== rowId);
    wrap.remove(); updateAllMealDropdowns(); checkAddButton(); calc();
  };

  cSel.value = rowData.cat; updateRecipeList();
  el("recipeList").appendChild(wrap);
  updateAllMealDropdowns(); checkAddButton();
}

function updateAllMealDropdowns() {
  const currentTotal = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  state.recipeRows.forEach(row => {
    const wrap = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"]`);
    if (!wrap) return;
    const mSel = wrap.querySelector(".mealsSel");
    const otherMeals = currentTotal - row.meals;
    const maxAvailable = MAX_TOTAL_MEALS - otherMeals;
    const prevVal = row.meals;
    mSel.innerHTML = "";
    for (let i = 0; i <= maxAvailable; i++) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = i;
      mSel.appendChild(opt);
    }
    mSel.value = Math.min(prevVal, maxAvailable);
    row.meals = Number(mSel.value);
  });
}

function checkAddButton() { el("addRecipe").disabled = state.recipeRows.length >= MAX_RECIPE_ROWS; }

function calc() {
  const exclude = new Set([...document.querySelectorAll(".exChk:checked")].map(c => c.dataset.iid));
  const replenishMap = new Map([...document.querySelectorAll(".repQty")].map(c => [c.dataset.iid, Number(c.value) || 0]));
  const totalMeals = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  el("summaryBadge").textContent = `${totalMeals}食 / 21食`;
  
  const netNeed = new Map();
  const displayOrder = [];
  
  state.recipeRows.forEach(row => {
    if (row.meals <= 0) return;
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r) return;
    const rowDays = row.meals / MEALS_PER_DAY;
    Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
      if (!displayOrder.includes(iid)) displayOrder.push(iid);
      const gross = qtyPerMeal * row.meals;
      const rowReplenish = (replenishMap.get(iid) || 0) * rowDays;
      netNeed.set(iid, (netNeed.get(iid) || 0) + (gross - rowReplenish));
    });
  });

  const resultGrid = el("resultGrid");
  resultGrid.innerHTML = "";
  let grandTotal = 0;
  displayOrder.forEach(iid => {
    if (exclude.has(iid)) return;
    const finalNeed = Math.max(0, Math.ceil(netNeed.get(iid) || 0));
    if (finalNeed > 0) {
      grandTotal += finalNeed;
      const ing = getIng(iid);
      resultGrid.innerHTML += `
        <div class="tile">
          <div class="tileName">${ing.name}</div>
          <img class="icon" src="${imgSrc(ing.file)}">
          <div style="font-weight:900; font-size:13px;">${finalNeed}個</div>
        </div>`;
    }
  });
  el("totalBadge").textContent = `総合計 ${grandTotal}個`;
}

window.onload = () => {
  console.log("app.js onload fired", window.__APP_JS_LOADED__, window.INGREDIENTS, window.RECIPES);

  resetSWAndCacheOnce();
  registerSW();
  renderGrids();

  if (typeof renderYearCalendar === "function") renderYearCalendar();
  if (typeof renderFieldMenu === "function") renderFieldMenu();

  const savedTab = localStorage.getItem('activeTab') || 'tab1';
  switchTab(savedTab, null);

  // ★ ここが重要：+追加 / クリア のボタンを再接続
  el("addRecipe").onclick = () => addRecipeRow({ meals: 0 });

  el("clearAll").onclick = () => {
    el("recipeList").innerHTML = "";
    state.recipeRows = [];
    document.querySelectorAll(".exChk").forEach(chk => chk.checked = false);
    document.querySelectorAll(".repQty").forEach(input => input.value = "");
    checkAddButton();
    addRecipeRow({ cat: "カレー・シチュー", recipeId: "avocado_gratin", meals: 0 });
    calc();
  };

  // 初期行がなければ1行追加
  if (state.recipeRows.length === 0) addRecipeRow({ meals: 0 });

  // お役立ち資料集モーダル
  const docsModal = el("docsModal");
  el("openDocs").onclick = () => docsModal.style.display = "flex";
  el("closeDocs").onclick = () => docsModal.style.display = "none";
  
  const modal = el("noticeModal");
  el("openNotice").onclick = () => modal.style.display = "flex";
  el("closeNotice").onclick = () => modal.style.display = "none";

  // 背景タップで閉じる（資料集/注意書き 両方）
  window.onclick = (e) => {
    if (e.target == modal) modal.style.display = "none";
    const docsModal = el("docsModal");
    if (e.target == docsModal) docsModal.style.display = "none";
  };
};

