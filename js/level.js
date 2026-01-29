"use strict";

/* =========================
 * Utilities
 * ========================= */
function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

(function () {

  let expTable = null;
  let shardTable = null;

  async function loadTablesOnce() {
    if (expTable && shardTable) return;
    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then(r => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then(r => r.text()),
    ]);
    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);
    buildNeedStepCache(); // ← 追加

  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach(line => {
      const s = line.trim();
      if (!s || s.startsWith("#") || s.startsWith("[")) return;
      const p = s.split(/\s+/);
      if (p.length < 2) return;
      const k = Number(p[0]);
      const v = toNum(p[1]);
      if (Number.isFinite(k) && Number.isFinite(v)) map.set(k, v);
    });
    return map;
  }

  function parseExpTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach(line => {
      const s = line.trim();
      if (!s || s.startsWith("#") || s.startsWith("[")) return;
      const p = s.split(/\s+/);
      if (p.length < 2) return;
      const lv = Number(p[0]);
      if (!Number.isFinite(lv)) return;
      map.set(lv, {
        normal: toNum(p[1]),
        "600": toNum(p[2]),
        semi: toNum(p[3]),
        legend: toNum(p[4]),
      });
    });
    return map;
  }

  /* =========================
   * 必要EXP（タイプ倍率）算出：累計→丸め→差分
   * ========================= */
  
  const TYPE_MUL = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };
  
  // Map<typeKey, Map<targetLv, needStep>>
  let needStepCache = null;
  
  function buildNeedStepCache() {
    if (!expTable) return;
  
    needStepCache = new Map();
  
    // ふつう（normal）はそのまま（exp_table の normal 列を使う）
    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) {
      const row = expTable.get(lv);
      normalMap.set(lv, row ? toNum(row.normal) : 0);
    }
    needStepCache.set("normal", normalMap);
  
    // 累計（ふつう）を作る
    const cumNormal = [0]; // index unused
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }
  
    // 600 / semi / legend を「累計→丸め→差分」で生成
    ["600", "semi", "legend"].forEach(typeKey => {
      const mul = TYPE_MUL[typeKey] || 1.0;
  
      const map = new Map();
      let prevScaled = 0;
  
      for (let lv = 2; lv <= 65; lv++) {
        const scaledCum = Math.round((cumNormal[lv] || 0) * mul);
        const step = scaledCum - prevScaled;
        map.set(lv, step);
        prevScaled = scaledCum;
      }
  
      needStepCache.set(typeKey, map);
    });
  }
  
  function getNeedStep(targetLv, typeKey) {
    if (!needStepCache) buildNeedStepCache();
    const m = needStepCache?.get(typeKey) || needStepCache?.get("normal");
    return m?.get(targetLv) || 0;
  }

  
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  /**
   * アメ1個あたりの基礎EXPを性格補正込みで算出
   * 数値は検証データに基づき、以下の固定値を使用します
   */
  function getCandyExp(level, natureKey, boostMul) {
    let base = 25;
    if (level < 25) base = 35;
    else if (level < 30) base = 30;

    let natureMul = 1.0;
    if (natureKey === "up") natureMul = 1.18;
    if (natureKey === "down") natureMul = 0.82;

    // 1個ずつの獲得EXPは四捨五入される
    let gain = Math.round(base * natureMul);
    return gain * boostMul;
  }

  function simulateCandiesAndShards(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, initialProgress, boostKind, boostCount } = opts;
    
    let candies = 0;
    let shards = 0;
    let lv = lvNow;
    let currentExp = initialProgress;

    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = (boostKind === "none") ? 1 : 2;
    const boostShardMul = (boostKind === "mini") ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const row = expTable.get(targetLv);
      if (!row) break;
      
      const needStep = getNeedStep(targetLv, typeKey);

      // このレベル（targetLv）に到達するまでアメを投入
      while (currentExp < needStep) {
        const useBoost = (boostRemain > 0 && boostKind !== "none");
        const bMul = useBoost ? boostExpMul : 1;
        const sMul = useBoost ? boostShardMul : 1;

        const gain = getCandyExp(lv, natureKey, bMul);
        const shardCost = (shardTable.get(targetLv) || 0) * sMul;

        candies++;
        shards += shardCost;
        currentExp += gain;

        if (useBoost) boostRemain--;
      }

      // レベルアップ処理：余剰EXPを次に持ち越し
      currentExp -= needStep;
      lv++;
    }

    return { candiesTotal: candies, shardsTotal: shards };
  }

  /* =========================
   * UI & Event Listeners
   * ========================= */
  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function showResult(html) {
    const box = el("lvResult");
    if (box) { box.innerHTML = html; box.style.display = "block"; }
  }

  async function onCalc() {
    const nowRaw = (el("lvNow")?.value ?? "").trim();
    const targetRaw = (el("lvTarget")?.value ?? "").trim();
    if (!nowRaw || !targetRaw) return;

    const lvNow = clampInt(nowRaw, 1, 64);
    const lvTarget = clampInt(targetRaw, 2, 65);
    if (lvTarget <= lvNow) {
      showResult(`<div class="lvlWarn">「目標のレベル」は「今のレベル」より大きい値にしてください</div>`);
      return;
    }

    await loadTablesOnce();
    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";
    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);
    const boostCount = clampInt(el("lvBoostCount")?.value || 0, 0, 9999);
    const miniCount = clampInt(el("lvMiniBoostCount")?.value || 0, 0, 9999);

    const needForNextLevel = getNeedStep(lvNow + 1, typeKey);
    let initialProgress = 0;
    if (progressExp > 0 && progressExp < needForNextLevel) {
      initialProgress = needForNextLevel - progressExp;
    }

    let totalExpNeeded = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) {
      totalExpNeeded += getNeedStep(i, typeKey);
    }

    totalExpNeeded = Math.max(0, totalExpNeeded - initialProgress);

    // シミュレーション実行
    const simNormal = simulateCandiesAndShards({ 
      lvNow, lvTarget, typeKey, natureKey, initialProgress, boostKind: "none" 
    });

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    if (boostCount > 0) {
      const simBoost = simulateCandiesAndShards({ 
        lvNow, lvTarget, typeKey, natureKey, initialProgress, boostKind: "full", boostCount 
      });
      html += `<div class="lvResSubTitle">アメブースト時 (x2 / かけらx5)</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }
    if (miniCount > 0) {
      const simMini = simulateCandiesAndShards({ 
        lvNow, lvTarget, typeKey, natureKey, initialProgress, boostKind: "mini", boostCount: miniCount 
      });
      html += `<div class="lvResSubTitle">ミニアメブースト時 (x2 / かけらx4)</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数</div><div class="lvResVal">${Math.max(0, simMini.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量</div><div class="lvResVal">${simMini.shardsTotal.toLocaleString()}</div></div>`;
    }
    showResult(html);
  }

  function clearAll() {
    ["lvNow", "lvTarget", "lvProgressExp", "lvCandyOwned", "lvBoostCount", "lvMiniBoostCount"].forEach(id => {
      if (el(id)) el(id).value = (id.includes("Boost") ? "0" : "");
    });
    const box = el("lvResult"); if (box) { box.innerHTML = ""; box.style.display = "none"; }
  }

  function setVal(inputEl, v) {
    if (!inputEl) return;
    inputEl.value = String(v);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bindOnce() {
    el("lvCalc")?.addEventListener("click", onCalc);
    el("lvClear")?.addEventListener("click", clearAll);
    
    document.getElementById("tab3")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lvlQuickBtn"); if (!btn) return;
      if (btn.dataset.now) setVal(el("lvNow"), btn.dataset.now);
      if (btn.dataset.target) setVal(el("lvTarget"), btn.dataset.target);
      if (btn.dataset.boost) { setVal(el("lvBoostCount"), btn.dataset.boost); setVal(el("lvMiniBoostCount"), 0); }
      if (btn.dataset.mini) { setVal(el("lvMiniBoostCount"), btn.dataset.mini); setVal(el("lvBoostCount"), 0); }
    });
  }

  window.LevelTab = {
    init() {
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    }
  };

})();

