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
    show(["[Unhandled Promise Rejection]", reason || "(no reason)"].join("\n"));
  });

  window.__APP_JS_LOADED__ = true;
})();

/* =========================================================
   SW / Cache reset (一回だけ)
========================================================= */
async function resetSWAndCacheOnce() {
  const KEY = "sw_cache_reset_done_v120";
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

const MEALS_PER_DAY = 3;
const WEEK_DAYS = 7;
const WEEK_MEALS = 21;
const MODE3_TOTAL_MEALS = 63;

// ② 異なるレシピを組み合わせて21食：最大行数
const MAX_ROWS_MODE2 = 6;

// NCピカ（1日あたり差し引き分）※値はここで固定
const NC_APPLE = 12;
const NC_CACAO = 5;
const NC_HONEY = 3;

const CATS_3 = ["カレー・シチュー", "サラダ", "デザート・ドリンク"];

const MODES = {
  ONE: "mode1", // 同じレシピだけを21食
  MIX: "mode2", // 異なるレシピを組み合わせて21食
  PRESET63: "mode3", // 3カテゴリ合計63食
};

let state = {
  mode: MODES.ONE,
  recipeRows: [], // { rowId, cat, recipeId, meals, autoAdjust }
};

/* =========================================================
   オプション（localStorage）
========================================================= */
const OPT_KEYS = {
  ncPika: "opt_nc_pika_subtract",
  mode: "opt_calc_mode",
};

function getOptStr(key, def = "") {
  const v = localStorage.getItem(key);
  return v === null ? def : v;
}

function setOptStr(key, val) {
  localStorage.setItem(key, String(val));
}

function getOptBool(key, def = false) {
  const v = localStorage.getItem(key);
  if (v === null) return def;
  return v === "1";
}

function setOptBool(key, val) {
  localStorage.setItem(key, val ? "1" : "0");
}

/* =========================================================
   helpers
========================================================= */
function getIng(id) {
  return (window.INGREDIENTS || []).find((x) => x.id === id);
}

function imgSrc(file) {
  return "images/" + encodeURIComponent(file);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getFirstRecipeIdByCat(cat) {
  const first = (window.RECIPES || []).find((r) => r.cat === cat);
  return first ? first.id : null;
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
   モードUI
========================================================= */
function syncModeUIFromStorage() {
  const saved = getOptStr(OPT_KEYS.mode, MODES.ONE);
  const mode = Object.values(MODES).includes(saved) ? saved : MODES.ONE;

  const r1 = el("calcMode1");
  const r2 = el("calcMode2");
  const r3 = el("calcMode3");
  if (r1) r1.checked = mode === MODES.ONE;
  if (r2) r2.checked = mode === MODES.MIX;
  if (r3) r3.checked = mode === MODES.PRESET63;

  state.mode = mode;

  document.body.classList.toggle("mode3", mode === MODES.PRESET63);
}

function bindModeUI() {
  const radios = document.querySelectorAll('input[name="calcMode"]');
  if (!radios.length) return;

  radios.forEach((r) => {
    r.onchange = () => {
      if (!r.checked) return;
      // value は MODES.ONE/MIX/PRESET63（= "mode1"/"mode2"/"mode3"）を想定
      setOptStr(OPT_KEYS.mode, r.value);
      setMode(r.value);
    };
  });
}

function setMode(mode) {
  const next =
    mode === MODES.ONE || mode === MODES.MIX || mode === MODES.PRESET63
      ? mode
      : MODES.ONE;

  state.mode = next;

  document.body.classList.toggle("mode3", next === MODES.PRESET63);
   
  setOptStr(OPT_KEYS.mode, next);

  // ラジオ表示も合わせる（ズレ防止）
  const r1 = el("calcMode1");
  const r2 = el("calcMode2");
  const r3 = el("calcMode3");
  if (r1) r1.checked = next === MODES.ONE;
  if (r2) r2.checked = next === MODES.MIX;
  if (r3) r3.checked = next === MODES.PRESET63;

  // UI/State を作り直す
  const list = el("recipeList");
  if (list) list.innerHTML = "";
  state.recipeRows = [];

  if (state.mode === MODES.ONE) {
    addRecipeRow({
      cat: "カレー・シチュー",
      
      meals: WEEK_MEALS,
    });
  } else if (state.mode === MODES.MIX) {
    const cat = "カレー・シチュー";
    const rid = getFirstRecipeIdByCat(cat);

    // 初期2行（最後の行で残りを自動調整）
    addRecipeRow({
      cat,
      recipeId: rid,
      meals: 0,
    });
    addRecipeRow({
      cat,
      recipeId: rid,
      meals: 0,
    });

    applyAutoAdjustFlagAndBalance();
  } else if (state.mode === MODES.PRESET63) {

    CATS_3.forEach((cat) => {
      addRecipeRow({
        cat,
        recipeId: getFirstRecipeIdByCat(cat),
        meals: WEEK_MEALS,
      });
    });
  }
  updateMode3Notice();
  updateAllMealDropdowns();
  calc();
}



/* =========================================================
   料理行UI
========================================================= */
function setSummaryBadge(totalMeals) {
  const badge = el("summaryBadge");
  if (!badge) return;

  const max =
    state.mode === MODES.PRESET63 ? MODE3_TOTAL_MEALS : WEEK_MEALS;

  badge.textContent = `${totalMeals}食 / ${max}食`;
}

function updateModeDependentUI() {
  const addBtn = el("addRecipe");
  const mode3Note = el("mode3Note");

  if (mode3Note) {
    mode3Note.style.display = state.mode === MODES.PRESET63 ? "block" : "none";
  }

  if (!addBtn) return;

  if (state.mode === MODES.ONE || state.mode === MODES.PRESET63) {
    addBtn.disabled = true;
  } else {
    addBtn.disabled = state.recipeRows.length >= 6;
  }
}

function rebuildRecipeRowsForMode() {
  const list = el("recipeList");
  if (!list) return;

  list.innerHTML = "";
  state.recipeRows = [];

  if (state.mode === MODES.ONE) {
    addRecipeRow({
      cat: "カレー・シチュー",
      recipeId: getFirstRecipeIdByCat("カレー・シチュー"),
      meals: 21,
      fixed: true,
      showRemove: false,
      showMeals: false,
    });
  } else if (state.mode === MODES.MIX) {
    const cat = "カレー・シチュー";
    const rid = getFirstRecipeIdByCat(cat);

    // 初期2行：両方 0食（自動調整はしない）
    addRecipeRow({
      cat,
      recipeId: rid,
      meals: 0,
      fixed: false,
      showRemove: false, // 先頭は削除不可
      showMeals: true,
    });
    addRecipeRow({
      cat,
      recipeId: rid,
      meals: 0,
      fixed: false,
      showRemove: true,
      showMeals: true,
    });

    state.recipeRows.forEach((r) => (r.autoAdjust = false));
    document
      .querySelectorAll("#recipeList .recipeRow .mealsSel")
      .forEach((sel) => (sel.disabled = false));
  } else if (state.mode === MODES.PRESET63) {
    CATS_3.forEach((cat) => {
      addRecipeRow({
        cat,
        recipeId: getFirstRecipeIdByCat(cat),
        meals: 21,
        fixed: true,
        showRemove: false,
        showMeals: false,
      });
    });
  }

  updateModeDependentUI();
  updateAllMealDropdowns();
}

function addRecipeRow(init) {
  // ①/③ は行追加禁止（setMode側で作るだけ）
  if (state.mode === MODES.ONE || state.mode === MODES.PRESET63) {
    if (state.recipeRows.length >= (state.mode === MODES.ONE ? 1 : 3)) return;
  }

  // ② は最大6行
  if (state.mode === MODES.MIX && state.recipeRows.length >= MAX_ROWS_MODE2) return;

  const rowId = crypto.randomUUID();
  const rowData = {
    rowId,
    cat: init?.cat || "カレー・シチュー",
    recipeId: init?.recipeId || getFirstRecipeIdByCat(init?.cat || "カレー・シチュー"),
    meals: Number(init?.meals ?? 0),
  };
  state.recipeRows.push(rowData);

  const wrap = document.createElement("div");
  wrap.className = "recipeRow";
  wrap.dataset.rowId = rowId;

  const showRemove = (state.mode === MODES.MIX || state.mode === MODES.PRESET63);

  wrap.innerHTML = `
    ${showRemove ? `<button class="removeBtn" title="削除">×</button>` : ``}
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
    <div class="preview"></div>
  `;

  const cSel = wrap.querySelector(".catSel");
  const rSel = wrap.querySelector(".recipeSel");
  const mSel = wrap.querySelector(".mealsSel");
  // ---- 強調（触れるプルダウンだけ目立たせる）
  // ルール：
  // ①：カテゴリ + 料理
  // ②：カテゴリ(先頭行だけ) + 料理 + 食数
  // ③：料理
  function setEmph(sel, on) {
    if (!sel) return;
    const lab = sel.previousElementSibling; // <label>が直前にある前提
    sel.classList.toggle("emphSelect", !!on);
    if (lab && lab.tagName === "LABEL") lab.classList.toggle("emphLabel", !!on);
  }

  const isMode1 = state.mode === MODES.ONE;
  const isMode2 = state.mode === MODES.MIX;
  const isMode3 = state.mode === MODES.PRESET63;

  // いったん全部OFF（再描画・再計算時のズレ防止）
  setEmph(cSel, false);
  setEmph(rSel, false);
  setEmph(mSel, false);

  if (isMode1) {
    setEmph(cSel, !cSel.disabled);
    setEmph(rSel, !rSel.disabled);
  } else if (isMode2) {
    // ②は先頭行だけカテゴリ触れる（= disabledで判定してOK）
    setEmph(cSel, !cSel.disabled);
    setEmph(rSel, !rSel.disabled);
    setEmph(mSel, !mSel.disabled);
  } else if (isMode3) {
    setEmph(rSel, !rSel.disabled);
  }
  const pre = wrap.querySelector(".preview");

  // ---- カテゴリ制約（②は「先頭行のカテゴリに統一」）
  // ①：カテゴリ変更OK（1行だけ）
  // ②：先頭行だけ変更OK、2行目以降は選択不可（先頭に追従）
  // ③：カテゴリ固定（選択不可）
  const rowIndex = state.recipeRows.findIndex((r) => r.rowId === rowId);
  if (state.mode === MODES.MIX && rowIndex !== 0) {
    wrap.classList.add("catLocked");
  } else {
    wrap.classList.remove("catLocked");
  }
  if (state.mode === MODES.PRESET63) {
    cSel.disabled = true;
  } else if (state.mode === MODES.MIX) {
    if (rowIndex === 0) {
      cSel.disabled = false;
    } else {
      cSel.disabled = true;
    }
  } else {
    cSel.disabled = false;
  }

  // ---- 食数制約
  // ①：21固定（選択不可）
  // ③：21固定（選択不可）
  // ②：合計21になる範囲で選択可
  if (state.mode === MODES.ONE || state.mode === MODES.PRESET63) {
    mSel.disabled = true;
  } else {
    mSel.disabled = false;
  }

  // 初期値反映
  cSel.value = rowData.cat;

  const updateRecipeList = () => {
    const filtered = RECIPES.filter((r) => r.cat === cSel.value);
    rSel.innerHTML = filtered.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");

    if (filtered.some((r) => r.id === rowData.recipeId)) {
      rSel.value = rowData.recipeId;
    } else {
      rowData.recipeId = filtered[0]?.id || "";
      rSel.value = rowData.recipeId;
    }
    updatePreview();
  };

  const updatePreview = () => {
    rowData.cat = cSel.value;
    rowData.recipeId = rSel.value;

    // meals は updateAllMealDropdowns が最終確定（ここでは現状 value を読むだけ）
    rowData.meals = Number(mSel.value || rowData.meals || 0);

    const r = RECIPES.find((x) => x.id === rSel.value);
    if (r) {
      const totalIngredients = Object.values(r.ingredients).reduce((sum, c) => sum + c, 0);
      let html = Object.entries(r.ingredients)
        .map(([id, q]) => {
          const ing = getIng(id);
          return `<span><img src="${imgSrc(ing.file)}" style="width:14px; height:14px; margin-right:4px; vertical-align:middle;">${q}</span>`;
        })
        .join("");
      html += `<span class="badge" style="margin-left: auto; background:var(--main-soft); color:var(--main); border:1px solid #cce5ff; padding: 2px 10px; font-size: 11px;">${totalIngredients}個</span>`;
      pre.innerHTML = html;
    }

    // ②で先頭カテゴリが変わったら、他の行もカテゴリ固定で追従させる
    if (state.mode === MODES.MIX) {
      const head = state.recipeRows[0];
      if (head) {
        state.recipeRows.forEach((rr) => (rr.cat = head.cat));
        document.querySelectorAll(".recipeRow").forEach((rowEl, i) => {
          const cs = rowEl.querySelector(".catSel");
          if (!cs) return;
          cs.value = head.cat;
          cs.disabled = i !== 0; // 先頭以外はロック
        });
      }
    }

    updateAllMealDropdowns();
    calc();
  };

  cSel.onchange = () => {
    // ②：先頭行でカテゴリ変更したら、他行は追従＆料理もカテゴリ先頭に寄せる
    if (state.mode === MODES.MIX) {
      const headCat = cSel.value;
      state.recipeRows.forEach((rr) => (rr.cat = headCat));
      // 他行：cat固定＆recipeをカテゴリ先頭に寄せる
      state.recipeRows.forEach((rr, idx) => {
        if (idx === 0) return;
        rr.recipeId = getFirstRecipeIdByCat(headCat);
        const w = document.querySelector(`.recipeRow[data-row-id="${rr.rowId}"]`);
        if (!w) return;
        const cs = w.querySelector(".catSel");
        const rs = w.querySelector(".recipeSel");
        if (cs) cs.value = headCat;
        if (rs) {
          const filtered = RECIPES.filter((x) => x.cat === headCat);
          rs.innerHTML = filtered.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
          rs.value = rr.recipeId;
        }
      });
    }
    updateRecipeList();
  };

  rSel.onchange = updatePreview;
  mSel.onchange = updatePreview;

   const rm = wrap.querySelector(".removeBtn");
   if (rm) {
     rm.onclick = () => {
       // ★モード③：最低1カテゴリは残す
       if (state.mode === MODES.PRESET63 && state.recipeRows.length <= 1) return;
   
       state.recipeRows = state.recipeRows.filter((r) => r.rowId !== rowId);
       wrap.remove();
   
       updateAllMealDropdowns();
       checkAddButton();
       updateMode3Notice?.();
       calc();
     };
   }

  // meals 選択肢は updateAllMealDropdowns に任せる（初期だけ仮セット）
  mSel.innerHTML = `<option value="${rowData.meals}">${rowData.meals}</option>`;
  mSel.value = String(rowData.meals);

  updateRecipeList();
  el("recipeList").appendChild(wrap);

  updateAllMealDropdowns();
  checkAddButton();
}


function applyAutoAdjustFlagAndBalance() {
  state.recipeRows.forEach((r) => (r.autoAdjust = false));
  if (state.recipeRows.length >= 2) {
    state.recipeRows[state.recipeRows.length - 1].autoAdjust = true;
  }

  state.recipeRows.forEach((row) => {
    const wrap = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"]`);
    if (!wrap) return;
    const mSel = wrap.querySelector(".mealsSel");
    if (mSel) mSel.disabled = row.autoAdjust;
    const cSel = wrap.querySelector(".catSel");
    if (cSel && state.mode === MODES.MIX) {
      const first = state.recipeRows[0];
      cSel.disabled = !first || first.rowId !== row.rowId;
    }
  });

  const manualRows = state.recipeRows.filter((r) => !r.autoAdjust);
  const autoRow = state.recipeRows.find((r) => r.autoAdjust);

  const manualSum = manualRows.reduce((s, r) => s + (r.meals || 0), 0);
  const remaining = clamp(WEEK_MEALS - manualSum, 0, WEEK_MEALS);

  if (autoRow) {
    autoRow.meals = remaining;
    const wrap = document.querySelector(`.recipeRow[data-row-id="${autoRow.rowId}"]`);
    const mSel = wrap ? wrap.querySelector(".mealsSel") : null;
    if (mSel) mSel.value = String(remaining);
  }

  updateAllMealDropdowns();
}

/* =========================================================
   食数ドロップダウン再計算
========================================================= */
function updateAllMealDropdowns() {
   let totalMeals = 0;
   
   if (state.mode === MODES.ONE) {
     totalMeals = WEEK_MEALS;
   } else if (state.mode === MODES.PRESET63) {
     // ★残っているカテゴリ数 × 21
     totalMeals = (state.recipeRows.length || 1) * WEEK_MEALS;
   } else {
     totalMeals = state.recipeRows.reduce((sum, r) => sum + (Number(r.meals) || 0), 0);
   }


  // バッジ更新
  const badge = el("summaryBadge");
  if (badge) {
    const cap = state.mode === MODES.PRESET63 ? WEEK_MEALS * 3 : WEEK_MEALS;
    badge.textContent = `${totalMeals}食 / ${cap}食`;
  }

  // 各行の mealsSel を更新
  state.recipeRows.forEach((row, idx) => {
    const wrap = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"]`);
    if (!wrap) return;
    const mSel = wrap.querySelector(".mealsSel");
    if (!mSel) return;

    // ①/③：21固定
    if (state.mode === MODES.ONE || state.mode === MODES.PRESET63) {
      row.meals = WEEK_MEALS;
      mSel.innerHTML = `<option value="${WEEK_MEALS}">${WEEK_MEALS}</option>`;
      mSel.value = String(WEEK_MEALS);
      mSel.disabled = true;
      return;
    }

    // ②：合計21になる範囲で可変
    mSel.disabled = false;

    const currentTotal = state.recipeRows.reduce((s, r) => s + (Number(r.meals) || 0), 0);
    const otherMeals = currentTotal - (Number(row.meals) || 0);
    const maxAvailable = Math.max(0, WEEK_MEALS - otherMeals);

    const prevVal = Number(row.meals) || 0;

    mSel.innerHTML = "";
    for (let i = 0; i <= maxAvailable; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      mSel.appendChild(opt);
    }

    const newVal = Math.min(prevVal, maxAvailable);
    mSel.value = String(newVal);
    row.meals = newVal;
  });

  // ②：合計が21を超えたら最後の行で調整（要件A）
  if (state.mode === MODES.MIX && state.recipeRows.length) {
    let sum = state.recipeRows.reduce((s, r) => s + (Number(r.meals) || 0), 0);
    if (sum > WEEK_MEALS) {
      const last = state.recipeRows[state.recipeRows.length - 1];
      const overflow = sum - WEEK_MEALS;
      last.meals = Math.max(0, (Number(last.meals) || 0) - overflow);

      const w = document.querySelector(`.recipeRow[data-row-id="${last.rowId}"]`);
      const ms = w ? w.querySelector(".mealsSel") : null;
      if (ms) ms.value = String(last.meals);
    }
  }

  checkAddButton();
}

function checkAddButton() {
  const btn = el("addRecipe");
  if (!btn) return;

  // ①：追加不可
  if (state.mode === MODES.ONE) {
    btn.disabled = true;
    btn.style.opacity = "0.4";
    btn.style.cursor = "not-allowed";
    return;
  }

  // ②：最大6行
  if (state.mode === MODES.MIX) {
    const canAdd = state.recipeRows.length < MAX_ROWS_MODE2;
    btn.disabled = !canAdd;
    btn.style.opacity = canAdd ? "1" : "0.4";
    btn.style.cursor = canAdd ? "pointer" : "not-allowed";
    return;
  }

  // ③：欠けているカテゴリがある時だけ追加可能（最大3カテゴリ）
  if (state.mode === MODES.PRESET63) {
    const existing = new Set(state.recipeRows.map((r) => r.cat));
    const missing = CATS_3.filter((c) => !existing.has(c));
    const canAdd = missing.length > 0;

    btn.disabled = !canAdd;
    btn.style.opacity = canAdd ? "1" : "0.4";
    btn.style.cursor = canAdd ? "pointer" : "not-allowed";
    return;
  }

  // 念のため
  btn.disabled = true;
  btn.style.opacity = "0.4";
  btn.style.cursor = "not-allowed";
}



/* =========================================================
   計算ロジック（モード別）
========================================================= */

// (1) 1日あたり獲得量（ユーザー入力 + NCピカ補正）を取得
function buildReplenishPerDayMap() {
  const map = new Map(
    [...document.querySelectorAll(".repQty")].map((c) => [
      c.dataset.iid,
      Number(c.value) || 0,
    ])
  );

  // NCピカ（チェックONなら 1日あたり：リンゴ12 / カカオ5 / ミツ3 を追加で差し引く）
  const cbNc = el("optNcPika");
  const ncOn = cbNc ? cbNc.checked : false;
  if (ncOn) {
    map.set("apple", (map.get("apple") || 0) + NC_APPLE);
    map.set("cacao", (map.get("cacao") || 0) + NC_CACAO);
    map.set("honey", (map.get("honey") || 0) + NC_HONEY);
  }

  return map;
}

// (2) 除外チェック
function buildExcludeSet() {
  return new Set(
    [...document.querySelectorAll(".exChk:checked")].map((c) => c.dataset.iid)
  );
}

// (3) レシピから「週のグロス必要量」を作る（モード別）
function calcWeeklyGrossNeedMap() {
  const need = new Map(); // iid -> weekly gross amount (before replenish)
  const displayOrder = []; // 表示順

  // helper
  const addNeed = (iid, v) => {
    if (!displayOrder.includes(iid)) displayOrder.push(iid);
    need.set(iid, (need.get(iid) || 0) + v);
  };
  const setNeedMax = (iid, v) => {
    if (!displayOrder.includes(iid)) displayOrder.push(iid);
    const prev = need.has(iid) ? need.get(iid) : -Infinity;
    if (v > prev) need.set(iid, v);
  };

  // モード①：同じレシピを21食（グロス＝qtyPerMeal * 21）
  if (state.mode === MODES.ONE) {
    const row = state.recipeRows[0];
    const r = RECIPES.find((x) => x.id === row.recipeId);
    if (!r) return { need, displayOrder };

    Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
      addNeed(iid, qtyPerMeal * WEEK_MEALS);
    });

    return { need, displayOrder };
  }

  // モード②：異なるレシピを組合せて21食
  // グロス＝qtyPerMeal * meals（合算）
  if (state.mode === MODES.MIX) {
    state.recipeRows.forEach((row) => {
      const meals = Number(row.meals) || 0;
      if (meals <= 0) return;

      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        addNeed(iid, qtyPerMeal * meals);
      });
    });

    return { need, displayOrder };
  }

  // モード③：3カテゴリ固定（各21食）、重複は最大値参照
  // グロス＝max(各カテゴリでの qtyPerMeal) * 21
  if (state.mode === MODES.PRESET63) {
    // 3行想定：catがそれぞれ固定
    state.recipeRows.forEach((row) => {
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        // このカテゴリのレシピ「1食あたり数」の最大値を採用
        setNeedMax(iid, qtyPerMeal * WEEK_MEALS);
      });
    });

    return { need, displayOrder };
  }

  return { need, displayOrder };
}

// (4) 獲得量差し引き（モード別）
//  - モード①： (qtyPerMeal*3 - perDayReplenish) * 7 を引く（= qtyPerMeal*21 - perDay*7 と等価）
//  - モード②： (sumQtyPerMeal*3 - perDayReplenish) * 7 を引く
//      ※sumQtyPerMeal は「選択した複数レシピの 1食あたり食材数を合算」
//      例：ミート(16+9)=25 → (25*3 - perDay)*7
//  - モード③： (maxQtyPerMeal*3 - perDayReplenish) * 7 を引く
function calcWeeklySubtractByReplenish(displayOrder) {
  const perDay = buildReplenishPerDayMap(); // iid -> perDay amount (NC込み)
  const subtract = new Map(); // iid -> weekly subtract amount
  const used = new Set(displayOrder); // レシピで使う食材だけ対象

  // helper
  const setSub = (iid, val) => {
    if (!used.has(iid)) return;
    subtract.set(iid, val);
  };

  // モード①：単一レシピ
  if (state.mode === MODES.ONE) {
    const row = state.recipeRows[0];
    const r = RECIPES.find((x) => x.id === row.recipeId);
    if (!r) return subtract;

    Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
      const pd = perDay.get(iid) || 0;
      const weekly = (qtyPerMeal * MEALS_PER_DAY - pd) * 7;
      setSub(iid, weekly);
    });

    return subtract;
  }

  // モード②：複数レシピ合算（1食あたりを合算して3食×7日）
  if (state.mode === MODES.MIX) {
    const perMealSum = new Map(); // iid -> sum of qtyPerMeal across selected recipes (NOT weighted by meals)
    // ↑ 要件：「レシピに記載されている食材の合計個数×3-1日当たり」なので、食数で重み付けしない

    state.recipeRows.forEach((row) => {
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;
      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        perMealSum.set(iid, (perMealSum.get(iid) || 0) + qtyPerMeal);
      });
    });

    perMealSum.forEach((sumQtyPerMeal, iid) => {
      if (!used.has(iid)) return;
      const pd = perDay.get(iid) || 0;
      const weekly = (sumQtyPerMeal * MEALS_PER_DAY - pd) * 7;
      setSub(iid, weekly);
    });

    return subtract;
  }

  // モード③：最大値（1食あたり最大）で3食×7日
  if (state.mode === MODES.PRESET63) {
    const perMealMax = new Map(); // iid -> max qtyPerMeal among 3 category recipes

    state.recipeRows.forEach((row) => {
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;
      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        const prev = perMealMax.has(iid) ? perMealMax.get(iid) : -Infinity;
        if (qtyPerMeal > prev) perMealMax.set(iid, qtyPerMeal);
      });
    });

    perMealMax.forEach((maxQtyPerMeal, iid) => {
      if (!used.has(iid)) return;
      const pd = perDay.get(iid) || 0;
      const weekly = (maxQtyPerMeal * MEALS_PER_DAY - pd) * 7;
      setSub(iid, weekly);
    });

    return subtract;
  }

  return subtract;
}

/* =========================================================
   週必要量の最終計算＆描画（モード別：グロス＝食材×食数）
   mode1: 単一レシピ * 21
   mode2: 各レシピの食材 * そのレシピの食数（例：24*15 + 28*6）
   mode3: 3カテゴリの重複食材は「1食あたり最大値」* 21
   subtract: (1日当たり獲得量 + NC分) * 7 を引く（使う食材だけ）
========================================================= */
function calc() {
  const exclude = buildExcludeSet();
  const perDay = buildReplenishPerDayMap(); // NC分込み（1日あたり）
  const resultGrid = el("resultGrid");
  if (!resultGrid) return;

  // 週グロス必要量（レシピ由来）を作る
  const gross = new Map(); // iid -> weekly gross
  const order = [];        // 表示順（出現順）

  const pushOrder = (iid) => { if (!order.includes(iid)) order.push(iid); };
  const addGross = (iid, v) => {
    pushOrder(iid);
    gross.set(iid, (gross.get(iid) || 0) + v);
  };
  const setGrossMax = (iid, v) => {
    pushOrder(iid);
    const prev = gross.has(iid) ? gross.get(iid) : -Infinity;
    if (v > prev) gross.set(iid, v);
  };

  if (state.mode === MODES.ONE) {
    const row = state.recipeRows[0];
    const r = RECIPES.find((x) => x.id === row?.recipeId);
    if (r) {
      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        addGross(iid, qtyPerMeal * WEEK_MEALS); // 1食あたり * 21食
      });
    }
  } else if (state.mode === MODES.MIX) {
    // ★ここが今回の修正点：qtyPerMeal * meals で積み上げる
    state.recipeRows.forEach((row) => {
      const meals = Number(row.meals) || 0;
      if (meals <= 0) return;

      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        addGross(iid, qtyPerMeal * meals);
      });
    });
  } else if (state.mode === MODES.PRESET63) {
    // 3カテゴリ：重複は「1食あたり最大値」を採用し、それ * 21
    state.recipeRows.forEach((row) => {
      const r = RECIPES.find((x) => x.id === row.recipeId);
      if (!r) return;

      Object.entries(r.ingredients).forEach(([iid, qtyPerMeal]) => {
        setGrossMax(iid, qtyPerMeal * WEEK_MEALS);
      });
    });
  }

  // 描画（除外・獲得量差し引き）
  resultGrid.innerHTML = "";
  let grandTotal = 0;

  order.forEach((iid) => {
    if (exclude.has(iid)) return;

    const g = gross.get(iid) || 0;
    if (g <= 0) return;

    // 1日当たり獲得量は「使う食材だけ」対象（grossにある＝使う）
   const pd = perDay.get(iid) || 0;
   
   // ===============================
   // モード②のみ：入力済み食数に比例して差し引く
   // ===============================
   let subtractAmt = pd * WEEK_DAYS; // デフォルト：7日分（①・③）
   
   if (state.mode === MODES.MIX) {
     const totalMeals = state.recipeRows.reduce(
       (sum, r) => sum + (Number(r.meals) || 0),
       0
     );
     subtractAmt = pd * (totalMeals / MEALS_PER_DAY); // 食数 ÷ 3 日分
   }
   
   const finalNeed = Math.max(0, Math.round(g - subtractAmt));

    if (finalNeed <= 0) return;

    grandTotal += finalNeed;

    const ing = getIng(iid);
    resultGrid.innerHTML += `
      <div class="tile">
        <div class="tileName">${ing ? ing.name : iid}</div>
        <img class="icon" src="${imgSrc(ing ? ing.file : "")}">
        <div style="font-weight:900; font-size:13px;">${finalNeed}個</div>
      </div>
    `;
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

  const nc = document.getElementById("optNcPika");
   document.querySelectorAll(".repQty").forEach((inp) => {
     inp.addEventListener("input", () => calc());
   });

   
  if (nc) nc.addEventListener("change", () => calc());

   
  if (window.CalendarTab && typeof window.CalendarTab.renderYearCalendar === "function") {
    window.CalendarTab.renderYearCalendar();
  }
  if (window.PokedexTab && typeof window.PokedexTab.renderFieldMenu === "function") {
    window.PokedexTab.renderFieldMenu();
  }

  const savedTab = localStorage.getItem("activeTab") || "tab1";
  window.switchTab(savedTab, null);
   
   const addBtn = el("addRecipe");
   if (addBtn) {
     addBtn.onclick = () => {
       // ②：先頭カテゴリを複製
       if (state.mode === MODES.MIX) {
         const head = state.recipeRows[0];
         const headCat = head?.cat || "カレー・シチュー";
   
         addRecipeRow({
           cat: headCat,
           recipeId: getFirstRecipeIdByCat(headCat),
           meals: 0,
         });
   
         updateAllMealDropdowns();
         checkAddButton();
         calc();
         return;
       }
   
       // ③：欠けているカテゴリを21食で復活
       if (state.mode === MODES.PRESET63) {
         const existing = new Set(state.recipeRows.map((r) => r.cat));
         const missing = CATS_3.filter((c) => !existing.has(c));
         if (missing.length === 0) return;
   
         const cat = missing[0]; // 先頭の欠けカテゴリを復活
         addRecipeRow({
           cat,
           recipeId: getFirstRecipeIdByCat(cat),
           meals: WEEK_MEALS, // 21固定
         });
   
         updateAllMealDropdowns();
         checkAddButton();
         updateMode3Notice?.();
         calc();
         return;
       }
   
       // ①：何もしない
     };
   }

   
   // モードUI：保存状態を先に反映 → イベント接続 → そのモードで初期構築
   syncModeUIFromStorage();
   bindModeUI();
   setMode(state.mode);



  // クリア
  const clearBtn = el("clearAll");
  if (clearBtn) {
    clearBtn.onclick = () => {
      const list = el("recipeList");
      if (list) list.innerHTML = "";
      state.recipeRows = [];

      document.querySelectorAll(".exChk").forEach((chk) => (chk.checked = false));
      document.querySelectorAll(".repQty").forEach((input) => (input.value = ""));

      // モードは初期に戻す
      state.mode = MODES.ONE;

      // 初期行を作る（前半の setMode などがある想定）
      if (typeof setMode === "function") {
        setMode(MODES.ONE);
      } else {
        // フォールバック：とりあえず1行作る
        addRecipeRow({ meals: WEEK_MEALS });
        updateAllMealDropdowns();
        calc();
      }
    };
  }

  // 初期行がなければ1行追加（前半でモード初期化済み前提）
  if (state.recipeRows.length === 0) {
    if (typeof setMode === "function") {
      setMode(state.mode || MODES.ONE);
    } else {
      addRecipeRow({ meals: WEEK_MEALS });
    }
  }

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

  updateMode3Notice();
   
  // 初回描画
  updateAllMealDropdowns();
  calc();
};

// =========================================================
// タブ切替（index.html の onclick から呼ばれる）
// =========================================================
window.switchTab = function (tabId, clickedEl) {
  // コンテンツ切替
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  // ナビのactive切替（clickedEl が来る場合）
  if (clickedEl) {
    document.querySelectorAll(".bottom-nav .nav-item").forEach((n) => n.classList.remove("active"));
    clickedEl.classList.add("active");
  } else {
    // 復元時：tabIdからactiveを推定
    const map = { tab1: 0, tab2: 1, tab3: 2 };
    const idx = map[tabId] ?? 0;
    const items = document.querySelectorAll(".bottom-nav .nav-item");
    items.forEach((n) => n.classList.remove("active"));
    if (items[idx]) items[idx].classList.add("active");
  }

  // ヘッダタイトル
  const headerTitle = document.getElementById("headerTitle");
  if (headerTitle) {
    headerTitle.textContent =
      tabId === "tab2" ? "出現ポケモン一覧" :
      tabId === "tab3" ? "月齢カレンダー" :
      "食材ストック計算";
  }

  // 保存
  localStorage.setItem("activeTab", tabId);

  // タブ固有の初期描画
  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
};

// =========================================================
// タブ切替（HTMLのonclickから呼ばれるのでグローバルに置く）
// =========================================================
window.switchTab = window.switchTab || function (tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".bottom-nav .nav-item").forEach((n) => n.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");

  localStorage.setItem("activeTab", tabId);
};

function updateMode3Notice() {
  const note = document.getElementById("mode3Note"); 
  if (!note) return;
  note.style.display = (state.mode === MODES.PRESET63) ? "block" : "none";
}



