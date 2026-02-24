"use strict";

/* =========================================================
   テーマカラー定義
========================================================= */
const THEMES = {
  red:        { name: "レッド",       main: "#ff4757", soft: "#ffe6e7" },
  pink:       { name: "ピンク",       main: "#ff6b81", soft: "#ffeff1" },
  orange:     { name: "オレンジ",     main: "#ffa502", soft: "#fff5e0" },
  yellow:     { name: "イエロー",     main: "#eccc68", soft: "#fbf6e3" },
  green:      { name: "グリーン",     main: "#558b2f", soft: "#f1f8e9" },
  lightgreen: { name: "ライトグリーン", main: "#2ed573", soft: "#eafaf1" },
  blue:       { name: "ブルー",       main: "#007bff", soft: "#eaf4ff" },
  lightblue:  { name: "ライトブルー",   main: "#87cefa", soft: "#e1f5fe" },
  purple:     { name: "パープル",     main: "#5352ed", soft: "#eeedff" },
  brown:      { name: "ブラウン",     main: "#a0522d", soft: "#f5ebe0" }
};

/* =========================================================
   診断モード
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
  const KEY = "sw_cache_reset_done_v116"; // ★アップデート用バージョン
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

const MAX_ROWS = 12;
const NC_APPLE = 12;
const NC_CACAO = 5;
const NC_HONEY = 3;

// レシピレベルボーナス
const RECIPE_LEVEL_BONUS = [
  0, 0.00, 0.02, 0.04, 0.06, 0.08, 0.09, 0.11, 0.13, 0.16, 0.18,
  0.19, 0.21, 0.23, 0.24, 0.26, 0.28, 0.30, 0.31, 0.33, 0.35,
  0.37, 0.40, 0.42, 0.45, 0.47, 0.50, 0.52, 0.55, 0.58, 0.61,
  0.64, 0.67, 0.70, 0.74, 0.77, 0.81, 0.84, 0.88, 0.92, 0.96,
  1.00, 1.04, 1.08, 1.13, 1.17, 1.22, 1.27, 1.32, 1.37, 1.42,
  1.48, 1.53, 1.59, 1.65, 1.71, 1.77, 1.83, 1.90, 1.97, 2.03,
  2.09, 2.15, 2.21, 2.27, 2.34
];

// イベントボーナスパターン
const EVENT_PATTERNS = {
  "0": { normal: 1.0, great: 2.0, sunday: 3.0 },
  "1": { normal: 1.1, great: 2.2, sunday: 3.3 },
  "2": { normal: 1.25, great: 2.5, sunday: 3.75 },
  "3": { normal: 1.5, great: 3.0, sunday: 4.5 }
};

let state = {
  recipeRows: [], 
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
   テーマカラー処理
========================================================= */
function applyTheme(themeKey) {
  const t = THEMES[themeKey] || THEMES["blue"];
  const root = document.documentElement;
  
  root.style.setProperty("--main", t.main);
  root.style.setProperty("--main-soft", t.soft);
  
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = t.main;

  localStorage.setItem("appTheme", themeKey);
}

function renderThemeGrid() {
  const container = el("themeGrid");
  if (!container) return;
  container.innerHTML = "";

  Object.keys(THEMES).forEach(key => {
    const t = THEMES[key];
    const btn = document.createElement("div");
    btn.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      border: 1px solid #eee; border-radius: 12px;
      cursor: pointer; background: #fff;
      transition: background 0.1s;
    `;
    btn.innerHTML = `
      <div style="width:24px; height:24px; border-radius:50%; background:${t.main}; border:2px solid #fff; box-shadow:0 0 0 1px #ddd;"></div>
      <div style="font-size:12px; font-weight:800; color:#333;">${t.name}</div>
    `;
    
    btn.onclick = () => {
      applyTheme(key);
      el("themeModal").style.display = "none";
    };
    
    container.appendChild(btn);
  });
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

  document.querySelectorAll(".exChk").forEach((chk) => {
    chk.onchange = () => calc();
  });

  document.querySelectorAll(".repQty").forEach((input) => {
    input.oninput = () => {
      if (input.value !== "") {
        let v = parseInt(input.value, 10);
        if (v < 0) v = 0;
        if (v > 999) v = 999;
        if (String(v) !== input.value) input.value = v;
      }
      calc();
    };
  });
}

/* =========================================================
   食数ドロップダウンの更新ロジック
========================================================= */
function refreshAllMealDropdowns() {
  state.recipeRows.forEach(row => {
    const wrap = document.querySelector(`.recipeRow[data-row-id="${row.rowId}"]`);
    if (!wrap) return;
    const mSel = wrap.querySelector(".mealsSel");
    if (!mSel) return;

    const intendedVal = row.meals;
    
    const otherTotal = state.recipeRows
      .filter(r => r.rowId !== row.rowId)
      .reduce((sum, r) => sum + r.meals, 0);
    const maxAllowed = Math.max(0, 21 - otherTotal);

    mSel.innerHTML = "";
    
    const effectiveMax = Math.max(maxAllowed, intendedVal); 
    
    for (let i = effectiveMax; i >= 0; i--) {
      if (i > maxAllowed && i !== intendedVal) continue; 
      
      const opt = document.createElement("option");
      opt.value = i; 
      opt.textContent = i;
      mSel.appendChild(opt);
    }
    
    if (intendedVal <= maxAllowed) {
      mSel.value = intendedVal;
    } else {
      mSel.value = maxAllowed;
      row.meals = maxAllowed;
    }
  });
  updateSummary();
}

/* =========================================================
   行追加ロジック (初期食数0)
========================================================= */
function addRecipeRow(init) {
  if (state.recipeRows.length >= MAX_ROWS) return;

  const rowId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("rid_" + Date.now() + "_" + Math.random().toString(16).slice(2));
  
  let initialMeals = 0;
  if (init && typeof init.meals === 'number') {
    initialMeals = init.meals;
  } else {
    initialMeals = 0;
  }

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

  const radioName = `success_${rowId}`;

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
    if (document.activeElement === mSel) {
       rowData.meals = Number(mSel.value);
    }
    
    rowData.level = Number(lSel.value) || 1;
    rowData.successType = wrap.querySelector(`input[name="${radioName}"]:checked`).value;

    const r = RECIPES.find((x) => x.id === rSel.value);
    if (r) {
      const totalIngredients = Object.values(r.ingredients).reduce((sum, c) => sum + c, 0);
      let html = Object.entries(r.ingredients).map(([id, q]) => {
        const ing = getIng(id);
        return `<span><img src="${imgSrc(ing?.file)}">${q}</span>`;
      }).join("");
      html += `<span class="badge" style="margin-left: auto; background:var(--main-soft); color:var(--main); border:1px solid #cce5ff; padding: 2px 10px; font-size: 11px;">${totalIngredients}個</span>`;
      pre.innerHTML = html;
    }
    calc();
  };

  cSel.onchange = updateRecipeList;
  rSel.onchange = () => {
    const selectedText = rSel.options[rSel.selectedIndex]?.text || rSel.value;
    if (typeof gtag === 'function') {
      gtag('event', 'select_recipe', { 'recipe_name': selectedText, 'category': cSel.value });
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
  
  radios.forEach(ra => {
    if (ra.value === rowData.successType) ra.checked = true;
    ra.onchange = updatePreview;
  });

  wrap.querySelector(".removeBtn").onclick = () => {
    state.recipeRows = state.recipeRows.filter((r) => r.rowId !== rowId);
    wrap.remove();
    refreshAllMealDropdowns();
    calc();
  };

  updateRecipeList();
  el("recipeList").appendChild(wrap);
  refreshAllMealDropdowns();
  updatePreview();
}

function updateSummary() {
  const totalMeals = state.recipeRows.reduce((sum, r) => sum + r.meals, 0);
  const badge = el("summaryBadge");
  if (badge) badge.textContent = `${totalMeals}食 / 21食`;
  
  const addBtn = el("addRecipe");
  if (addBtn) addBtn.disabled = state.recipeRows.length >= MAX_ROWS;
}

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

  const fbVal = Number(el("fieldBonusSel")?.value || 0);
  const fbMul = 1 + (fbVal / 100);
  const evPatKey = el("eventBonusSel")?.value || "0";
  const evPattern = EVENT_PATTERNS[evPatKey];

  const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
  const ingredientOrder = [];
  let totalEnergy = 0;

  state.recipeRows.forEach(row => {
    const r = RECIPES.find(x => x.id === row.recipeId);
    if (!r || row.meals <= 0) return;

    const baseEnergy = r.baseEnergy;
    const lv = Math.max(1, Math.min(65, row.level || 1));
    const bonusPct = RECIPE_LEVEL_BONUS[lv];
    const lvBonusVal = Math.round(baseEnergy * bonusPct);
    
    const displayEnergy = baseEnergy + lvBonusVal;

    let evMul = 1.0;
    if (row.successType === "great") evMul = evPattern.great;
    else if (row.successType === "sunday") evMul = evPattern.sunday;
    else evMul = evPattern.normal;

    const oneMealEnergy = Math.floor(displayEnergy * fbMul * evMul);
    totalEnergy += (oneMealEnergy * row.meals);

    const map = catSums[row.cat];
    Object.entries(r.ingredients).forEach(([iid, qty]) => {
      if (!ingredientOrder.includes(iid)) ingredientOrder.push(iid);
      map.set(iid, (map.get(iid) || 0) + (qty * row.meals));
    });
  });

  const energyRes = el("energyResultVal");
  if (energyRes) energyRes.textContent = totalEnergy.toLocaleString();

  // ラジオボタンの選択モードを取得
  const calcMode = document.querySelector('input[name="calcMode"]:checked')?.value || "default";

  // モードごとの総数計算
  const gross = new Map();
  Object.values(catSums).forEach(map => {
    map.forEach((val, iid) => {
      if (calcMode === "simple") {
        gross.set(iid, (gross.get(iid) || 0) + val);
      } else {
        gross.set(iid, Math.max(gross.get(iid) || 0, val));
      }
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
   スナップショット機能
========================================================= */
const SS_KEYS = ["stockcalc_ss_1", "stockcalc_ss_2", "stockcalc_ss_3"];
const SS_POINTER_KEY = "stockcalc_ss_pointer";

function setupLongPress(element, callback, clickCallback) {
  let timer;
  let isLong = false;
  
  const start = (e) => {
    if (e.type === "mousedown" && e.button !== 0) return;
    isLong = false;
    timer = setTimeout(() => {
      isLong = true;
      if(navigator.vibrate) navigator.vibrate(50);
      callback();
    }, 800); 
  };
  
  const cancel = () => {
    if (timer) clearTimeout(timer);
  };
  
  const end = (e) => {
    if (timer) clearTimeout(timer);
    if (!isLong && clickCallback) {
      clickCallback(e);
    }
  };
  
  element.addEventListener("mousedown", start);
  element.addEventListener("touchstart", start, { passive: true });
  
  element.addEventListener("mouseup", end);
  element.addEventListener("mouseleave", cancel);
  element.addEventListener("touchend", end);
  element.addEventListener("touchmove", cancel);
}

function getCurrentState() {
  const recipes = JSON.parse(JSON.stringify(state.recipeRows));
  const fieldBonus = el("fieldBonusSel")?.value || "85";
  const eventBonus = el("eventBonusSel")?.value || "0";
  const ncPika = el("optNcPika")?.checked || false;
  const calcMode = document.querySelector('input[name="calcMode"]:checked')?.value || "default";
  
  const ingredients = [];
  document.querySelectorAll(".repQty").forEach(input => {
    const iid = input.dataset.iid;
    const qty = input.value;
    const isExcluded = document.querySelector(`.exChk[data-iid="${iid}"]`)?.checked || false;
    ingredients.push({ iid, qty, isExcluded });
  });

  return { recipes, fieldBonus, eventBonus, ncPika, ingredients, calcMode };
}

function restoreState(data) {
  if (!data) return;

  el("recipeList").innerHTML = "";
  state.recipeRows = [];
  
  if (el("fieldBonusSel")) el("fieldBonusSel").value = data.fieldBonus || "85";
  if (el("eventBonusSel")) el("eventBonusSel").value = data.eventBonus || "0";
  if (el("optNcPika")) el("optNcPika").checked = !!data.ncPika;

  if (data.calcMode) {
    const radio = document.querySelector(`input[name="calcMode"][value="${data.calcMode}"]`);
    if (radio) radio.checked = true;
  } else {
    const defaultRadio = document.querySelector('input[name="calcMode"][value="default"]');
    if (defaultRadio) defaultRadio.checked = true;
  }

  if (data.ingredients) {
    data.ingredients.forEach(item => {
      const qtyInput = document.querySelector(`.repQty[data-iid="${item.iid}"]`);
      const exCheck = document.querySelector(`.exChk[data-iid="${item.iid}"]`);
      if (qtyInput) qtyInput.value = item.qty;
      if (exCheck) exCheck.checked = item.isExcluded;
    });
  }

  if (data.recipes && data.recipes.length > 0) {
    data.recipes.forEach(row => {
      addRecipeRow(row); 
    });
  } else {
    addRecipeRow({ meals: 21 });
  }

  refreshAllMealDropdowns();
  calc();
}

function updateSSButtons() {
  const btns = document.querySelectorAll(".ss-btn");
  btns.forEach(btn => {
    const ssid = parseInt(btn.dataset.ssid);
    const key = SS_KEYS[ssid - 1];
    const hasData = !!localStorage.getItem(key);
    
    if (hasData) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function createSnapshot() {
  const current = getCurrentState();
  
  let targetIndex = -1;
  for (let i = 0; i < 3; i++) {
    if (!localStorage.getItem(SS_KEYS[i])) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    const pointerStr = localStorage.getItem(SS_POINTER_KEY);
    targetIndex = pointerStr ? parseInt(pointerStr) : 0;
    
    const nextPointer = (targetIndex + 1) % 3;
    localStorage.setItem(SS_POINTER_KEY, nextPointer);
  }

  const targetKey = SS_KEYS[targetIndex];
  localStorage.setItem(targetKey, JSON.stringify(current));
  
  showInfo(`スロ${targetIndex + 1} に保存しました`);
  updateSSButtons();
}

function loadSnapshot(ssid) {
  const key = SS_KEYS[ssid - 1];
  const raw = localStorage.getItem(key);
  if (!raw) return;
  
  try {
    const data = JSON.parse(raw);
    restoreState(data);
    showInfo(`スロ${ssid} を読み込みました`);
  } catch(e) {
    console.error(e);
    showInfo("データの読み込みに失敗しました");
  }
}

function clearSnapshot(ssid) {
  if (confirm(`スロット${ssid} を削除しますか？`)) {
    const key = SS_KEYS[ssid - 1];
    localStorage.removeItem(key);
    updateSSButtons();
  }
}

function initSnapshotFeature() {
  const createBtn = el("createSnapshotBtn");
  if (createBtn) createBtn.onclick = createSnapshot;

  const ssBtns = document.querySelectorAll(".ss-btn");
  ssBtns.forEach(btn => {
    const ssid = parseInt(btn.dataset.ssid);
    setupLongPress(
      btn, 
      () => clearSnapshot(ssid),
      () => loadSnapshot(ssid)
    );
  });
  updateSSButtons();
}

/* =========================================================
   キーボード監視機能 (iOS/Android対応)
========================================================= */
function initKeyboardObserver() {
  if (window.visualViewport) {
    const initialHeight = window.visualViewport.height;
    window.visualViewport.addEventListener("resize", () => {
      // 画面の高さが初期値より大きく縮んだら（キーボードが出現したら）
      if (window.visualViewport.height < initialHeight - 150) {
        document.body.classList.add("keyboard-open");
      } else {
        document.body.classList.remove("keyboard-open");
      }
    });
  } else {
    // visualViewport非対応時のフォールバック
    const inputs = document.querySelectorAll("input, select, textarea");
    inputs.forEach(el => {
      el.addEventListener("focus", () => document.body.classList.add("keyboard-open"));
      el.addEventListener("blur", () => document.body.classList.remove("keyboard-open"));
    });
  }
}

/* =========================================================
   onload / タブ切替
========================================================= */
window.onload = () => {
  resetSWAndCacheOnce();
  registerSW();
  renderGrids();

  const savedTheme = localStorage.getItem("appTheme") || "blue";
  applyTheme(savedTheme);
  renderThemeGrid();

  el("openTheme").onclick = () => el("themeModal").style.display = "flex";
  el("closeTheme").onclick = () => el("themeModal").style.display = "none";

  el("fieldBonusSel")?.addEventListener("change", calc);
  el("eventBonusSel")?.addEventListener("change", calc);

  document.querySelectorAll('input[name="calcMode"]').forEach(r => r.addEventListener("change", calc));

  el("optNcPika")?.addEventListener("change", () => calc());
  el("addRecipe").onclick = () => addRecipeRow();
  
  el("clearAll").onclick = () => {
    
    el("recipeList").innerHTML = "";
    state.recipeRows = [];
    
    el("fieldBonusSel").value = "85";
    el("eventBonusSel").value = "0";
    el("optNcPika").checked = false;

    const defaultMode = document.querySelector('input[name="calcMode"][value="default"]');
    if (defaultMode) defaultMode.checked = true;

    document.querySelectorAll(".exChk").forEach(c => c.checked = false);
    document.querySelectorAll(".repQty").forEach(i => i.value = "");
    
    addRecipeRow({ meals: 0 });
    calc();
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
  
  initSnapshotFeature();
  initKeyboardObserver();

// ====== ここから追加（隠しゲーミングモード） ======
  let secretTapCount = 0;
  let secretTapTimer = null;

  const secretBtn = document.getElementById("secretGamingBtn");
  
  // ★ 変更1： \n ではなく <br> を使う
  const defaultText = "……おや！？<br>アプリの　ようすが……！";
  
  if (secretBtn) {
    secretBtn.addEventListener("click", () => {
      secretTapCount++;
      clearTimeout(secretTapTimer);
      
      const remain = 5 - secretTapCount;
      
      // ★ 変更2： innerText ではなく innerHTML を使い、<br> で確実につなぐ
      if (remain > 0) {
        secretBtn.innerHTML = `${defaultText}<br>(あと ${remain})`;
      }

      // タップするごとに少しずつ文字がはっきり見えるようにする演出
      secretBtn.style.opacity = Math.min(1, 0.15 + (secretTapCount * 0.2));
      
      // タマゴの揺れアニメーション
      secretBtn.classList.remove("egg-shaking");
      void secretBtn.offsetWidth; 
      secretBtn.classList.add("egg-shaking");
      
      // 1秒以内に連続タップしないと回数がリセットされる
      secretTapTimer = setTimeout(() => { 
        secretTapCount = 0; 
        secretBtn.style.opacity = 0.15; 
        secretBtn.innerHTML = defaultText; // ★変更3：innerHTMLで戻す
      }, 1000);
      
      // 5回連続でタップされたら
      if (secretTapCount === 5) {
        if (!document.body.classList.contains("gaming-mode")) {
          document.body.classList.add("gaming-mode");
           
          // モーダルを強制的に閉じる
          document.getElementById("themeModal").style.display = "none";
           
          let metaThemeColor = document.querySelector('meta[name="theme-color"]');
          if (!metaThemeColor) {
            metaThemeColor = document.createElement('meta');
            metaThemeColor.name = "theme-color";
            document.head.appendChild(metaThemeColor);
          }
          metaThemeColor.content = "#000000";

          window.showInfo("🌈 ゲーミングモード起動 🌈");
          
          if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
        }
        
        secretTapCount = 0;
        secretBtn.style.opacity = 0.15;
        secretBtn.innerHTML = defaultText; // ★変更4：innerHTMLで戻す
      }
    });
  }

  // テーマカラーを変更した時にゲーミングモードを終了する処理
  const themeGrid = document.getElementById("themeGrid");
  if (themeGrid) {
    themeGrid.addEventListener("click", () => {
      if (document.body.classList.contains("gaming-mode")) {
        document.body.classList.remove("gaming-mode");
        
        setTimeout(() => {
          const currentBg = getComputedStyle(document.body).getPropertyValue('--main').trim();
          let metaThemeColor = document.querySelector('meta[name="theme-color"]');
          if (metaThemeColor && currentBg) {
            metaThemeColor.content = currentBg;
          }
          window.showInfo("ゲーミングモードを終了しました");
        }, 100);
      }
    });
  }
  // ====== 追加ここまで ======
   
}; // ← window.onload の最後の閉じ括弧

window.switchTab = function (tabId, clickedEl) {
  if (typeof gtag === 'function') {
    gtag('event', 'tab_view', { 'tab_name': tabId });
  }

  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  el(tabId)?.classList.add("active");

  const items = document.querySelectorAll(".bottom-nav .nav-item");
  items.forEach(n => n.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");
  else {
    const idx = { tab1: 0, tab2: 1, tab3: 2, tab4: 3 }[tabId] || 0;
    items[idx]?.classList.add("active");
  }

  // ★ 画面幅に応じてヘッダーのタイトルを切り替え
  const isNarrow = window.innerWidth <= 380;
  const tab3Title = isNarrow ? "経験値シミュ" : "経験値シミュレーター";
  el("headerTitle").textContent = { tab1: "料理計算", tab2: "出現ポケモン一覧", tab3: tab3Title, tab4: "月齢カレンダー" }[tabId];
  localStorage.setItem("activeTab", tabId);

  if (tabId === "tab2" && window.PokedexTab?.renderFieldMenu) window.PokedexTab.renderFieldMenu();
  if (tabId === "tab3" && window.LevelTab?.init) window.LevelTab.init();
  if (tabId === "tab4" && window.CalendarTab?.renderYearCalendar) window.CalendarTab.renderYearCalendar();
};

window.showInfo = function(msg) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast-msg";
  toast.innerHTML = msg.replace(/\n/g, "<br>");
  container.appendChild(toast);
  
  // 2.8秒後に自動で消滅させる
  setTimeout(() => { toast.remove(); }, 2800);
};

window.openDoc = function(fileName) {
  const modal = document.getElementById("docViewerModal");
  const img = document.getElementById("docViewerImg");
  if (modal && img) {
    img.src = "images/" + fileName;
    modal.style.display = "flex";
  }
};
