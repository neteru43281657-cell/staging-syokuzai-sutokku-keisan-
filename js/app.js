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
    const msg = [
      "[JS Error]",
      e.message || "(no message)",
      `@ ${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`,
    ].join("\n");
    show(msg);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason =
      e.reason && (e.reason.stack || e.reason.message || String(e.reason));
    show(
      ["[Unhandled Promise Rejection]", reason || "(no reason)"].join("\n")
    );
  });

  window.__APP_JS_LOADED__ = true;
})();

/* =========================================================
   SW / Cache reset (一回だけ)
========================================================= */
async function resetSWAndCacheOnce() {
  const KEY = "sw_cache_reset_done_v111";
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
   基本
========================================================= */
const el = (id) => document.getElementById(id);

let state = { recipeRows: [] };

const MEALS_PER_DAY = 3;
const MAX_RECIPE_ROWS = 9;
const MAX_TOTAL_MEALS = 21;

/* =========================================================
   オプション設定（localStorage）
========================================================= */
const OPT_KEYS = {
  expand63: "opt_expand63_meals",
  maxOverlap: "opt_max_overlap_ingredient",
  setMeals21: "opt_set_meals_21",
  ncPika: "opt_nc_pika_subtract",
};

function getOptBool(key, def = false) {
  const v = localStorage.getItem(key);
  if (v === null) return def;
  return v === "1";
}

function setOptBool(key, val) {
  localStorage.setItem(key, val ? "1" : "0");
}

function getMaxTotalMeals() {
  return getOptBool(OPT_KEYS.expand63, false) ? 63 : MAX_TOTAL_MEALS;
}

function isMaxOverlapMode() {
  return getOptBool(OPT_KEYS.maxOverlap, false);
}

function syncOptionUIFromStorage() {
  const cb63 = el("optExpand63");
  if (cb63) cb63.checked = getOptBool(OPT_KEYS.expand63, false);

  const cbMax = el("optMaxOverlap");
  if (cbMax) cbMax.checked = getOptBool(OPT_KEYS.maxOverlap, false);

  const cb21 = el("optSetMeals21");
  if (cb21) cb21.checked = getOptBool(OPT_KEYS.setMeals21, false);

  const cbNc = el("optNcPika");
  if (cbNc) cbNc.checked = getOptBool(OPT_KEYS.ncPika, false);
}

function setSummaryBadge(totalMeals) {
  const badge = el("summaryBadge");
  if (!badge) return;
  badge.textContent = `${totalMeals}食 / ${getMaxTotalMeals()}食`;
}

/* =========================================================
   63食プリセット（3カテゴリ×先頭料理×21食）
========================================================= */
const CATS_3 = ["カレー・シチュー", "サラダ", "デザート・ドリンク"];

function getFirstRecipeIdByCat(cat) {
  const first = (window.RECIPES || []).find((r) => r.cat === cat);
  return first ? first.id : null;
}

function apply63PresetRows() {
  const list = el("recipeList");
  if (!list) return;

  // UIとstateを完全に作り直す
  list.innerHTML = "";
  state.recipeRows = [];

  CATS_3.forEach((cat) => {
    const rid = getFirstRecipeIdByCat(cat);
    if (!rid) return;
    addRecipeRow({ cat, recipeId: rid, meals: 21 });
  });

  // 安定化
  updateAllMealDropdowns();
  updateAllMealDropdowns();
  calc();
}

/* =========================================================
   食数を一括で21にする（63OFF時の挙動）
========================================================= */
// mode:
//  - "firstOnly": 先頭行だけ21
//  - "all": 全行21
function applyMeals21(mode = "all") {
  const rows = [...document.querySelectorAll(".recipeRow")];
  if (!rows.length) return;

  const targets = mode === "firstOnly" ? [rows[0]] : rows;

  // DOM側
  targets.forEach((wrap) => {
    const mSel = wrap.querySelector(".mealsSel");
    if (mSel) mSel.value = "21";
  });

  // state側
  const targetIds = new Set(targets.map((w) => w.dataset.rowId));
  state.recipeRows.forEach((r) => {
    if (targetIds.has(r.rowId)) r.meals = 21;
  });

  updateAllMealDropdowns();
  updateAllMealDropdowns();
  calc();
}

/* =========================================================
   オプションUIイベント接続
========================================================= */
function bindOptionUI() {
  // 63食
  const cb63 = el("optExpand63");
  if (cb63) {
    cb63.onchange = () => {
      setOptBool(OPT_KEYS.expand63, cb63.checked);

      if (cb63.checked) {
        apply63PresetRows(); // 3カテゴリ×各21
      } else {
        updateAllMealDropdowns();
        updateAllMealDropdowns();
        calc();
      }
    };
  }

  // 最大値計算
  const cbMax = el("optMaxOverlap");
  if (cbMax) {
    cbMax.onchange = () => {
      setOptBool(OPT_KEYS.maxOverlap, cbMax.checked);
      calc();
    };
  }

  // 食数を21食にする（トグル）
  const cb21 = el("optSetMeals21");
  if (cb21) {
    cb21.onchange = () => {
      // OFFにしたとき：チェックが外れるだけ（食数は触らない）
      if (!cb21.checked) {
        setOptBool(OPT_KEYS.setMeals21, false);
        return;
      }

      // ONにしたとき：チェックが入る → 先頭行だけ21食 → 21/21 表記
      setOptBool(OPT_KEYS.setMeals21, true);

      // 「21/21」にしたいので、63食は必ずOFFに戻す
      if (cb63) cb63.checked = false;
      setOptBool(OPT_KEYS.expand63, false);

      // 上限を21に戻した上で、先頭行だけ21を入れる
      updateAllMealDropdowns(); // まず上限(21)で再構築
      applyMeals21("firstOnly"); // 先頭行だけ21（この中でupdateAllMealDropdowns+calcまで走ります）
    };
  }

  // NCピカ（チェック入れた瞬間/外した瞬間に反映）
  const cbNc = el("optNcPika");
  if (cbNc) {
    cbNc.onchange = () => {
      setOptBool(OPT_KEYS.ncPika, cbNc.checked);
      calc();
    };
  }
}


/* =========================================================
   helper
========================================================= */
function getIng(id) {
  return INGREDIENTS.find((x) => x.id === id);
}

function imgSrc(file) {
  return "images/" + encodeURIComponent(file);
}

/* =========================================================
   タブ切替
========================================================= */
function switchTab(tabId, clickedEl) {
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((i) => i.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");

  if (clickedEl) {
    clickedEl.classList.add("active");
  } else {
    const targetNav = Array.from(document.querySelectorAll(".nav-item")).find(
      (n) => n.getAttribute("onclick") && n.getAttribute("onclick").includes(tabId)
    );
    if (targetNav) targetNav.classList.add("active");
  }

  localStorage.setItem("activeTab", tabId);

  const headerTitle = el("headerTitle");
  const headerVer = el("headerVer");
  if (tabId === "tab1") {
    headerTitle.textContent = "食材ストック計算";
    headerVer.textContent = "ver1.0.4";
  } else if (tabId === "tab2") {
    headerTitle.textContent = "出現ポケモン一覧";
    headerVer.textContent = "ver1.0.4";
  } else if (tabId === "tab3") {
    headerTitle.textContent = "2026年 月齢カレンダー";
    headerVer.textContent = "ver1.0.4";
  }

  window.scrollTo(0, 0);
}

/* =========================================================
   除外 / 1日当たり獲得量 グリッド描画
========================================================= */
function renderGrids() {
  const ex = el("excludeGrid"),
    rep = el("replenishGrid");
  if (!ex || !rep) return;

  ex.innerHTML = "";
  rep.innerHTML = "";

  INGREDIENTS.forEach((ing) => {
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
    input.oninput = (e) => {
      if (e.target.classList.contains("repQty")) {
        if (e.target.value > 999) e.target.value = 999;
        if (e.target.value < 0) e.target.value = 0;
      }
      calc();
    };
  });
}

/* =========================================================
   レシピ行追加（63ON時の21が0に潰れる問題を対策済み）
========================================================= */
function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_RECIPE_ROWS) return;

  const rowId = crypto.randomUUID();
  const rowData = {
    rowId,
    cat: init?.cat || "カレー・シチュー",
    recipeId: init?.recipeId || "avocado_gratin",
    meals: Number(init?.meals ?? 0),
  };
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

  const cSel = wrap.querySelector(".catSel");
  const rSel = wrap.querySelector(".recipeSel");
  const mSel = wrap.querySelector(".mealsSel");
  const pre = wrap.querySelector(".preview");

  // ★先に食数セレクトを作っておく（空のままupdatePreviewに入ると0に潰れるのを防止）
  const initMealsSelect = () => {
    mSel.innerHTML = "";
    for (let i = 0; i <= getMaxTotalMeals(); i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      mSel.appendChild(opt);
    }
    mSel.value = String(rowData.meals);
  };
  initMealsSelect();

  const updateRecipeList = () => {
    const filtered = RECIPES.filter((r) => r.cat === cSel.value);
    rSel.innerHTML = filtered
      .map((r) => `<option value="${r.id}">${r.name}</option>`)
      .join("");

    if (filtered.some((r) => r.id === rowData.recipeId)) {
      rSel.value = rowData.recipeId;
    } else {
      rowData.recipeId = rSel.value;
    }
    updatePreview();
  };

  const updatePreview = () => {
    rowData.cat = cSel.value;
    rowData.recipeId = rSel.value;

    // ★mSel.value が空文字の時に0で上書きしない（21が0に潰れる原因）
    rowData.meals =
      mSel.value === "" ? rowData.meals || 0 : Number(mSel.value);

    const r = RECIPES.find((x) => x.id === rSel.value);
    if (r) {
      const totalIngredients = Object.values(r.ingredients).reduce(
        (sum, count) => sum + count,
        0
      );
      let html = Object.entries(r.ingredients)
        .map(([id, q]) => {
          const ing = getIng(id);
          return `<span><img src="${imgSrc(
            ing.file
          )}" style="width:14px; height:14px; margin-right:4px; vertical-align:middle;">${q}</span>`;
        })
        .join("");
      html += `<span class="badge" style="margin-left: auto; background:var(--main-soft); color:var(--main); border:1px solid #cce5ff; padding: 2px 10px; font-size: 11px;">${totalIngredients}個</span>`;
      pre.innerHTML = html;
    }

    updateAllMealDropdowns();
    calc();
  };

  cSel.onchange = updateRecipeList;
  rSel.onchange = updatePreview;
  mSel.onchange = updatePreview;

  wrap.querySelector(".removeBtn").onclick = () => {
    state.recipeRows = state.recipeRows.filter((r) => r.rowId !== rowId);
    wrap.remove();

    // ★×で閉じたら「食数に21食を設定する」はOFFに戻す（要件）
    setOptBool(OPT_KEYS.setMeals21, false);
    const cb21 = el("optSetMeals21");
    if (cb21) cb21.checked = false;

    updateAllMealDropdowns();
    checkAddButton();
    calc();
  };

  cSel.value = rowData.cat;
  updateRecipeList();

  el("recipeList").appendChild(wrap);

  updateAllMealDropdowns();
  checkAddButton();
}

/* =========================================================
   食数ドロップダウン再計算（上限21/63）
========================================================= */
function updateAllMealDropdowns() {
  const currentTotal = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);

  state.recipeRows.forEach((row) => {
    const wrap = document.querySelector(
      `.recipeRow[data-row-id="${row.rowId}"]`
    );
    if (!wrap) return;

    const mSel = wrap.querySelector(".mealsSel");
    const otherMeals = currentTotal - row.meals;
    const maxAvailable = getMaxTotalMeals() - otherMeals;

    const prevVal = row.meals;

    mSel.innerHTML = "";
    for (let i = 0; i <= Math.max(0, maxAvailable); i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      mSel.appendChild(opt);
    }

    mSel.value = String(Math.min(prevVal, Math.max(0, maxAvailable)));
    row.meals = Number(mSel.value);
  });

  const totalMeals = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  setSummaryBadge(totalMeals);
}

function checkAddButton() {
  const btn = el("addRecipe");
  if (!btn) return;
  btn.disabled = state.recipeRows.length >= MAX_RECIPE_ROWS;
}

/* =========================================================
   計算（最大値モード＆NCピカ差し引き対応）
========================================================= */
function calc() {
  const exclude = new Set(
    [...document.querySelectorAll(".exChk:checked")].map((c) => c.dataset.iid)
  );

  const replenishMap = new Map(
    [...document.querySelectorAll(".repQty")].map((c) => [
      c.dataset.iid,
      Number(c.value) || 0,
    ])
  );

  // ★NCピカ（チェックONなら 1日あたり：リンゴ12 / カカオ5 / ミツ3 を差し引く）
  const cbNc = el("optNcPika");
  const ncOn = cbNc ? cbNc.checked : getOptBool(OPT_KEYS.ncPika, false);
  if (ncOn) {
    replenishMap.set("apple", (replenishMap.get("apple") || 0) + 12);
    replenishMap.set("cacao", (replenishMap.get("cacao") || 0) + 5);
    replenishMap.set("honey", (replenishMap.get("honey") || 0) + 3);
  }

  const totalMeals = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  setSummaryBadge(totalMeals);

  const netNeed = new Map();
  const displayOrder = [];

  if (!isMaxOverlapMode()) {
    // ===== 既存挙動（合算）=====
    state.recipeRows.forEach((row) => {
      if (row.meals <= 0) return;
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      const rowDays = row.meals / MEALS_PER_DAY;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        if (!displayOrder.includes(iid)) displayOrder.push(iid);

        const gross = qtyPerMeal * row.meals;
        const rowReplenish = (replenishMap.get(iid) || 0) * rowDays;

        netNeed.set(iid, (netNeed.get(iid) || 0) + (gross - rowReplenish));
      });
    });
  } else {
    // ===== 最大値モード（レシピ間の重複は最大値）=====
    state.recipeRows.forEach((row) => {
      if (row.meals <= 0) return;
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      const rowDays = row.meals / MEALS_PER_DAY;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        if (!displayOrder.includes(iid)) displayOrder.push(iid);

        const gross = qtyPerMeal * row.meals;
        const rowReplenish = (replenishMap.get(iid) || 0) * rowDays;
        const need = gross - rowReplenish;

        const prev = netNeed.has(iid) ? netNeed.get(iid) : -Infinity;
        if (need > prev) netNeed.set(iid, need);
      });
    });
  }

  // ===== 結果描画 =====
  const resultGrid = el("resultGrid");
  if (!resultGrid) return;

  resultGrid.innerHTML = "";
  let grandTotal = 0;

  displayOrder.forEach((iid) => {
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

  const totalBadge = el("totalBadge");
  if (totalBadge) totalBadge.textContent = `総合計 ${grandTotal}個`;
}

/* =========================================================
   お役立ち資料ビューア
========================================================= */
window.openDoc = function (fileName) {
  const viewer = document.getElementById("docViewerModal");
  const img = document.getElementById("docViewerImg");
  const title = document.getElementById("docViewerTitle");
  if (!viewer || !img || !title) return;

  title.textContent = fileName.replace(/\.png$/i, "");
  img.src = "images/" + encodeURIComponent(fileName);
  viewer.style.display = "flex";
};

/* =========================================================
   onload
========================================================= */
window.onload = () => {
  console.log("app.js onload fired", window.__APP_JS_LOADED__);

  resetSWAndCacheOnce();
  registerSW();

  renderGrids();

  if (window.CalendarTab && typeof window.CalendarTab.renderYearCalendar === "function") {
    window.CalendarTab.renderYearCalendar();
  }
  if (window.PokedexTab && typeof window.PokedexTab.renderFieldMenu === "function") {
    window.PokedexTab.renderFieldMenu();
  }

  const savedTab = localStorage.getItem("activeTab") || "tab1";
  switchTab(savedTab, null);

  // +追加
  const addBtn = el("addRecipe");
  if (addBtn) addBtn.onclick = () => addRecipeRow({ meals: 0 });

  // クリア
  const clearBtn = el("clearAll");
  if (clearBtn) {
    clearBtn.onclick = () => {
      const list = el("recipeList");
      if (list) list.innerHTML = "";
      state.recipeRows = [];

      document.querySelectorAll(".exChk").forEach((chk) => (chk.checked = false));
      document.querySelectorAll(".repQty").forEach((input) => (input.value = ""));

      // ★オプション類も全部リセット（UI & localStorage）
      setOptBool(OPT_KEYS.expand63, false);
      setOptBool(OPT_KEYS.maxOverlap, false);
      setOptBool(OPT_KEYS.setMeals21, false);
      setOptBool(OPT_KEYS.ncPika, false);

      const cb63 = el("optExpand63");
      if (cb63) cb63.checked = false;
      const cbMax = el("optMaxOverlap");
      if (cbMax) cbMax.checked = false;
      const cb21 = el("optSetMeals21");
      if (cb21) cb21.checked = false;
      const cbNc = el("optNcPika");
      if (cbNc) cbNc.checked = false;

      checkAddButton();

      // タブ1は「カレー・シチュー1行だけ表示」でOK（未入力）
      addRecipeRow({ cat: "カレー・シチュー", recipeId: "avocado_gratin", meals: 0 });

      updateAllMealDropdowns();
      calc();
    };
  }

  // 初期行がなければ1行追加
  if (state.recipeRows.length === 0) {
    addRecipeRow({ meals: 0 });
  }

  // オプションUI（初期反映＆イベント接続）
  syncOptionUIFromStorage();
  bindOptionUI();

  // お役立ち資料集モーダル
  const docsModal = el("docsModal");
  const openDocs = el("openDocs");
  const closeDocs = el("closeDocs");
  if (openDocs && docsModal) openDocs.onclick = () => (docsModal.style.display = "flex");
  if (closeDocs && docsModal) closeDocs.onclick = () => (docsModal.style.display = "none");

  // 注意書きモーダル
  const noticeModal = el("noticeModal");
  const openNotice = el("openNotice");
  const closeNotice = el("closeNotice");
  if (openNotice && noticeModal) openNotice.onclick = () => (noticeModal.style.display = "flex");
  if (closeNotice && noticeModal) closeNotice.onclick = () => (noticeModal.style.display = "none");

  // お役立ち資料：画像ビューア
  const docViewer = el("docViewerModal");
  const closeDocViewer = el("closeDocViewer");
  if (closeDocViewer && docViewer) closeDocViewer.onclick = () => (docViewer.style.display = "none");

  // 背景タップで閉じる
  window.onclick = (e) => {
    if (noticeModal && e.target === noticeModal) noticeModal.style.display = "none";
    if (docsModal && e.target === docsModal) docsModal.style.display = "none";
    if (docViewer && e.target === docViewer) docViewer.style.display = "none";
  };

  // 初回描画
  calc();
};
