  "use strict";
  
  const MAX_ROWS = 9;
  const WEEK_MEALS = 21;
  let state = { recipeRows: [] };
  
  const el = (id) => document.getElementById(id);
  const imgSrc = (file) => "images/" + encodeURIComponent(file);
  const getIng = (id) => (window.INGREDIENTS || []).find(x => x.id === id);
  
  function renderGrids() {
    const ex = el("excludeGrid"), rep = el("replenishGrid");
    if (!ex || !rep) return;
    ex.innerHTML = ""; rep.innerHTML = "";
  
    (window.INGREDIENTS || []).forEach(ing => {
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
          <div class="repInputRow">
            <input type="number" class="repQty" data-iid="${ing.id}" placeholder="xxx">
            <span class="unitLabel">個</span>
          </div>
        </div>`;
    });
    document.querySelectorAll(".exChk, .repQty").forEach(i => i.oninput = () => calc());
  }
  
  function addRecipeRow(init) {
    if (state.recipeRows.length >= MAX_ROWS) return;
  
    const rowId = "rid_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    const rowData = {
      rowId,
      cat: init?.cat || "カレー・シチュー",
      recipeId: init?.recipeId || window.RECIPES.find(r => r.cat === (init?.cat || "カレー・シチュー")).id,
      meals: Number(init?.meals ?? 0)
    };
    state.recipeRows.push(rowData);
  
    const wrap = document.createElement("div");
    wrap.className = "recipeRow";
    wrap.dataset.rowId = rowId;
    wrap.innerHTML = `
      <div class="removeBtn">×</div>
      <div style="flex:1; min-width:110px;"><label>カテゴリー</label>
        <select class="catSel emphSelect">
          <option value="カレー・シチュー">カレー・シチュー</option>
          <option value="サラダ">サラダ</option>
          <option value="デザート・ドリンク">デザート・ドリンク</option>
        </select>
      </div>
      <div style="flex:2; min-width:140px;"><label>料理</label><select class="recipeSel emphSelect"></select></div>
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
      const currentVal = row.meals;
      
      mSel.innerHTML = "";
      for (let i = 0; i <= maxAvail; i++) {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = i;
        mSel.appendChild(opt);
      }
      mSel.value = currentVal;
    });
    el("addRecipe").disabled = state.recipeRows.length >= MAX_ROWS;
  }
  
  // クイックボタン機能
  window.applyQuickSet = (cat) => {
    el("recipeList").innerHTML = ""; state.recipeRows = [];
    const defaultId = window.RECIPES.find(r => r.cat === cat).id;
    for(let i=0; i<3; i++) addRecipeRow({ cat, recipeId: defaultId, meals: 0 });
  };
  
  window.applyQuick21 = () => {
    if (state.recipeRows.length === 0) addRecipeRow();
    state.recipeRows.forEach((r, idx) => {
      r.meals = (idx === 0) ? 21 : 0;
      const mSel = document.querySelector(`.recipeRow[data-row-id="${r.rowId}"] .mealsSel`);
      if (mSel) {
        updateAllMealDropdowns(); // 選択肢をリフレッシュ
        mSel.value = r.meals;
      }
    });
    updateAllMealDropdowns();
    calc();
  };
  
  function calc() {
    // (中略: カテゴリ別合算 & 最大値ロジックは前回通り)
    const exclude = new Set([...document.querySelectorAll(".exChk:checked")].map(c => c.dataset.iid));
    const perDay = new Map([...document.querySelectorAll(".repQty")].map(c => [c.dataset.iid, Number(c.value) || 0]));
    if (el("optNcPika")?.checked) {
      perDay.set("apple", (perDay.get("apple") || 0) + 12);
      perDay.set("cacao", (perDay.get("cacao") || 0) + 5);
      perDay.set("honey", (perDay.get("honey") || 0) + 3);
    }
    const catSums = { "カレー・シチュー": new Map(), "サラダ": new Map(), "デザート・ドリンク": new Map() };
    state.recipeRows.forEach(row => {
      const r = window.RECIPES.find(x => x.id === row.recipeId);
      if (!r || row.meals <= 0) return;
      Object.entries(r.ingredients).forEach(([iid, qty]) => {
        catSums[row.cat].set(iid, (catSums[row.cat].get(iid) || 0) + (qty * row.meals));
      });
    });
    const finalGross = new Map();
    Object.values(catSums).forEach(map => {
      map.forEach((total, iid) => {
        if (total > (finalGross.get(iid) || 0)) finalGross.set(iid, total);
      });
    });
    const resultGrid = el("resultGrid"); resultGrid.innerHTML = ""; let grandTotal = 0;
    window.INGREDIENTS.forEach(ing => {
      if (exclude.has(ing.id)) return;
      const final = Math.max(0, (finalGross.get(ing.id) || 0) - (perDay.get(ing.id) || 0) * 7);
      if (final > 0) {
        grandTotal += final;
        resultGrid.innerHTML += `<div class="tile"><div class="tileName">${ing.name}</div><img class="icon" src="${imgSrc(ing.file)}"><div style="font-weight:900; font-size:13px;">${final.toLocaleString()}個</div></div>`;
      }
    });
    el("totalBadge").textContent = `総合計 ${grandTotal.toLocaleString()}個`;
  }
  
  window.onload = () => {
    renderGrids();
    el("addRecipe").onclick = () => addRecipeRow();
    el("clearAll").onclick = () => {
      el("recipeList").innerHTML = ""; state.recipeRows = [];
      document.querySelectorAll(".exChk").forEach(c => c.checked = false);
      document.querySelectorAll(".repQty").forEach(i => i.value = "");
      addRecipeRow({ meals: 0 });
      calc();
    };
    addRecipeRow({ meals: 0 });
  };
