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

  /* =========================
   * Constants & Tables
   * ========================= */
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
  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach(line => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
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
      if (!s || s.startsWith("#")) return;
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
   * Core calculations
   * ========================= */
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function baseCandyExp(level, nature) {
    let band;
    if (level < 25) band = "1_25";
    else if (level < 30) band = "25_30";
    else band = "30_plus";
  
    const table = {
      "1_25": { none: 35, up: 41, down: 29 },
      "25_30": { none: 30, up: 35, down: 25 },
      "30_plus": { none: 25, up: 30, down: 21 },
    };
    return table[band][nature] ?? table[band].none;
  }

  function calcTotalNeedExp(lvNow, lvTarget, typeKey) {
    let sum = 0;
    for (let to = lvNow + 1; to <= lvTarget; to++) {
      const row = expTable.get(to);
      if (!row) continue;
      sum += (row[typeKey] ?? row.normal);
    }
    return sum;
  }

  function simulateCandiesAndShards(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, progressExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
    
    const rowNext = expTable.get(lv + 1);
    const needForNext = rowNext ? (rowNext[typeKey] ?? rowNext.normal) : 0;
    let currentExp = (progressExp > 0 && progressExp < needForNext) ? (needForNext - progressExp) : 0;

    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = (boostKind === "none") ? 1 : 2;
    const boostShardMul = (boostKind === "mini") ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const row = expTable.get(targetLv);
      if (!row) break;
      const needStep = (row[typeKey] ?? row.normal);

      while (currentExp < needStep) {
        const useBoost = (boostRemain > 0 && boostKind !== "none");
        const gain = Math.floor(baseCandyExp(lv, natureKey) * (useBoost ? boostExpMul : 1));
        const shardCost = (shardTable.get(targetLv) || 0) * (useBoost ? boostShardMul : 1);
        candies++; shards += shardCost; currentExp += gain;
        if (useBoost) boostRemain--;
      }
      currentExp -= needStep; lv++;
    }
    return { candiesTotal: candies, shardsTotal: Math.round(shards) };
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

    const totalExp = calcTotalNeedExp(lvNow, lvTarget, typeKey);
    const simNormal = simulateCandiesAndShards({ lvNow, lvTarget, typeKey, natureKey, progressExp, boostKind: "none" });

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExp.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    if (boostCount > 0) {
      const simBoost = simulateCandiesAndShards({ lvNow, lvTarget, typeKey, natureKey, progressExp, boostKind: "full", boostCount });
      html += `<div class="lvResSubTitle">アメブースト時 (x2 / かけらx5)</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }
    if (miniCount > 0) {
      const simMini = simulateCandiesAndShards({ lvNow, lvTarget, typeKey, natureKey, progressExp, boostKind: "mini", boostCount: miniCount });
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
