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

// 四捨五入（0.5切り上げ）
function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

(function () {

  /* =========================
   * Constants
   * ========================= */
  const LV_MIN = 1;
  const LV_MAX = 65;

  const EXP_TYPE_MULT = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };

  /* =========================
   * Candy EXP per 1 candy
   * ========================= */
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

  /* =========================
   * Tables
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

      if (p.length === 2) {
        map.set(lv, toNum(p[1]));
        return;
      }

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

  function calcTotalNeedExp(lvNow, lvTarget, typeKey) {
    const mult = EXP_TYPE_MULT[typeKey] ?? 1.0;
    let sum = 0;

    for (let to = lvNow + 1; to <= lvTarget; to++) {
      const row = expTable.get(to);
      if (!row) throw new Error(`EXP tableにLv${to}が見つかりません`);

      const base = typeof row === "number" ? row : row.normal;
      const step = mult === 1.0 ? base : roundHalfUp(base * mult);
      sum += step;
    }
    return sum;
  }

  function simulateCandiesAndShards(opts) {
    const {
      lvNow, lvTarget, typeKey, natureKey,
      progressExp, boostKind, boostCount,
    } = opts;

    let candies = 0;
    let shards = 0;
    let lv = lvNow;
    let expCarry = Math.max(0, progressExp || 0);
    let boostRemain = Math.max(0, boostCount || 0);

    const boostExpMul = boostKind === "none" ? 1 : 2;
    const boostShardMul =
      boostKind === "mini" ? 4 :
      boostKind === "full" ? 5 : 1;

    while (lv < lvTarget) {
      const nextLv = lv + 1;
      const row = expTable.get(nextLv);
      if (!row) throw new Error(`EXP tableにLv${nextLv}が見つかりません`);

      const mult = EXP_TYPE_MULT[typeKey] ?? 1.0;
      const base = typeof row === "number" ? row : row.normal;
      const needStep = mult === 1.0 ? base : roundHalfUp(base * mult);

      let remain = needStep - expCarry;

      if (remain <= 0) {
        lv = nextLv;
        expCarry = -remain;
        continue;
      }

      const perCandy = baseCandyExp(lv, natureKey);
      const useBoost = boostRemain > 0 && boostKind !== "none";

      let gain = perCandy * (useBoost ? boostExpMul : 1);
      gain = Math.floor(gain);
      if (gain <= 0) gain = 1;

      const shardPer = shardTable.get(nextLv) || 0;
      const shardCost = shardPer * (useBoost ? boostShardMul : 1);

      candies++;
      shards += shardCost;
      expCarry += gain;

      if (useBoost) boostRemain--;
    }

    return {
      candiesTotal: candies,
      shardsTotal: Math.round(shards),
    };
  }

  /* =========================
   * UI
   * ========================= */
  const el = id => document.getElementById(id);
  const getRadio = name =>
    document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function showResult(html) {
    const box = el("lvResult");
    if (!box) return;
    box.innerHTML = html;
    box.style.display = "block";
  }

  function hideResult() {
    const box = el("lvResult");
    if (!box) return;
    box.style.display = "none";
    box.innerHTML = "";
  }

  function row(k, v) {
    return `<div class="lvResRow"><div class="lvResKey">${k}</div><div class="lvResVal">${v}</div></div>`;
  }

  async function onCalc() {
    hideResult();

    const lvNow = clampInt(el("lvNow")?.value, LV_MIN, LV_MAX);
    const lvTarget = clampInt(el("lvTarget")?.value, 2, LV_MAX);
    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";
    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);
    const boost = clampInt(el("lvBoost")?.value || 0, 0, 999);
    const mini = clampInt(el("lvMiniBoost")?.value || 0, 0, 999);

    if (boost > 0 && mini > 0) {
      showResult("ブーストはどちらか一方のみ指定できます");
      return;
    }

    await loadTablesOnce();

    const totalExp = calcTotalNeedExp(lvNow, lvTarget, typeKey);
    const sim = simulateCandiesAndShards({
      lvNow, lvTarget, typeKey, natureKey,
      progressExp,
      boostKind: mini > 0 ? "mini" : boost > 0 ? "full" : "none",
      boostCount: mini || boost || 0,
    });

    showResult([
      `<div class="lvResTitle">計算結果</div>`,
      row("必要経験値", `${totalExp.toLocaleString()} EXP`),
      row("必要なアメの数", `${Math.max(0, sim.candiesTotal - candyOwned).toLocaleString()} 個`),
      row("必要なゆめのかけら", `${sim.shardsTotal.toLocaleString()} 個`),
    ].join(""));
  }

  function bindOnce() {
    el("lvCalc")?.addEventListener("click", onCalc);
    el("lvClear")?.addEventListener("click", hideResult);
  }

  window.LevelTab = {
    init() {
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    },
  };

})();
