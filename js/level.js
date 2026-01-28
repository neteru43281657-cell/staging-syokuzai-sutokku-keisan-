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
  
    // 仕様通り：Lv1～25 / Lv25～30 / Lv30以上
    // ※境界を「含む」にするため <= を使う
    if (level <= 25) band = "1_25";
    else if (level <= 30) band = "25_30";
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
  function subTitle(t) {
    return `<div class="lvResSubTitle">${t}</div>`;
  }

  function clampIntoInput(inputEl, min, max) {
    if (!inputEl) return;
    inputEl.addEventListener("input", () => {
      if (inputEl.value === "") return; // 空は許す（未入力）
      const n = Number(inputEl.value);
      if (!Number.isFinite(n)) return;
      const v = Math.min(max, Math.max(min, Math.trunc(n)));
      if (String(v) !== inputEl.value) inputEl.value = String(v);
    });
  }

  function bindQuickButtons() {
    // 今のレベル
    document.querySelectorAll(".lvlQuickBtn[data-now]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = Number(btn.getAttribute("data-now") || 0);
        const now = el("lvNow");
        if (!now) return;
        if (Number.isFinite(v) && v >= 1 && v <= 64) now.value = String(v);
      });
    });

    // 目標レベル
    document.querySelectorAll(".lvlQuickBtn[data-target]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = Number(btn.getAttribute("data-target") || 0);
        const target = el("lvTarget");
        if (!target) return;
        if (Number.isFinite(v) && v >= 2 && v <= 65) target.value = String(v);
      });
    });

    // アメブースト（入力したらミニは0にする：択一）
    document.querySelectorAll(".lvlQuickBtn[data-boost]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = Number(btn.getAttribute("data-boost") || 0);
        const boost = el("lvBoostCount");
        const mini = el("lvMiniBoostCount");
        if (!boost || !mini) return;
        if (Number.isFinite(v) && v >= 0 && v <= 9999) {
          boost.value = String(v);
          if (v > 0) mini.value = "0";
        }
      });
    });

    // ミニアメブースト（入力したらアメブーストは0にする：択一）
    document.querySelectorAll(".lvlQuickBtn[data-mini]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = Number(btn.getAttribute("data-mini") || 0);
        const boost = el("lvBoostCount");
        const mini = el("lvMiniBoostCount");
        if (!boost || !mini) return;
        if (Number.isFinite(v) && v >= 0 && v <= 9999) {
          mini.value = String(v);
          if (v > 0) boost.value = "0";
        }
      });
    });
  }

  function bindExclusiveInputs() {
    const boost = el("lvBoostCount");
    const mini = el("lvMiniBoostCount");
    if (!boost || !mini) return;

    boost.addEventListener("input", () => {
      const v = Number(boost.value || 0);
      if (Number.isFinite(v) && v > 0) mini.value = "0";
    });

    mini.addEventListener("input", () => {
      const v = Number(mini.value || 0);
      if (Number.isFinite(v) && v > 0) boost.value = "0";
    });
  }

  function clearOptionalOnly() {
    if (el("lvProgressExp")) el("lvProgressExp").value = "";
    if (el("lvCandyOwned")) el("lvCandyOwned").value = "";
    if (el("lvBoostCount")) el("lvBoostCount").value = "0";
    if (el("lvMiniBoostCount")) el("lvMiniBoostCount").value = "0";
    hideResult();
  }

  function clearAll() {
    if (el("lvNow")) el("lvNow").value = "";
    if (el("lvTarget")) el("lvTarget").value = "";
    clearOptionalOnly();

    const natureNone = document.querySelector(`input[name="lvNature"][value="none"]`);
    if (natureNone) natureNone.checked = true;

    const typeNormal = document.querySelector(`input[name="lvType"][value="normal"]`);
    if (typeNormal) typeNormal.checked = true;
  }

  async function onCalc() {
    hideResult();

    const lvNow = clampInt(el("lvNow")?.value, LV_MIN, LV_MAX);      // 1〜64
    const lvTarget = clampInt(el("lvTarget")?.value, 2, LV_MAX);     // 2〜65
    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";

    // 任意入力：未入力は0扱い
    const progressExpRaw = el("lvProgressExp")?.value;
    const candyOwnedRaw = el("lvCandyOwned")?.value;

    const progressExp = progressExpRaw ? clampInt(progressExpRaw, 1, 9999) : 0;
    const candyOwned = candyOwnedRaw ? clampInt(candyOwnedRaw, 1, 9999) : 0;

    const boostCount = clampInt(el("lvBoostCount")?.value || 0, 0, 9999);
    const miniCount  = clampInt(el("lvMiniBoostCount")?.value || 0, 0, 9999);

    // 入力チェック
    if (lvNow < 1 || lvNow > 64) {
      showResult(`<div class="lvlWarn">「今のレベル」は 1〜64 で入力してください</div>`);
      return;
    }
    if (lvTarget < 2 || lvTarget > 65) {
      showResult(`<div class="lvlWarn">「目標のレベル」は 2〜65 で入力してください</div>`);
      return;
    }
    if (lvTarget <= lvNow) {
      showResult(`<div class="lvlWarn">「目標のレベル」は「今のレベル」より大きい値にしてください</div>`);
      return;
    }
    if (boostCount > 0 && miniCount > 0) {
      showResult(`<div class="lvlWarn">ブーストは「アメブースト / ミニアメブースト」のどちらか一方のみ入力してください</div>`);
      return;
    }

    await loadTablesOnce();

    // 必要経験値（ブーストに関係なし）
    const totalExp = calcTotalNeedExp(lvNow, lvTarget, typeKey);

    // 通常（ブーストなし）
    const simNormal = simulateCandiesAndShards({
      lvNow, lvTarget, typeKey, natureKey,
      progressExp,
      boostKind: "none",
      boostCount: 0,
    });

    const html = [];
    html.push(`<div class="lvResTitle">計算結果</div>`);
    html.push(row("必要経験値", `${totalExp.toLocaleString()} EXP`));
    html.push(row("必要なアメの数", `${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個`));
    html.push(row("必要なゆめのかけら量", `${simNormal.shardsTotal.toLocaleString()} 個`));

    // アメブースト時（入力されている時だけ表示）
    if (boostCount > 0) {
      const simBoost = simulateCandiesAndShards({
        lvNow, lvTarget, typeKey, natureKey,
        progressExp,
        boostKind: "full",      // EXP×2 / かけら×5
        boostCount: boostCount,
      });
      html.push(subTitle(`アメブースト時（EXP×2 / かけら×5）`));
      html.push(row("必要なアメの数", `${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個`));
      html.push(row("必要なゆめのかけら量", `${simBoost.shardsTotal.toLocaleString()} 個`));
    }

    // ミニアメブースト時（入力されている時だけ表示）
    if (miniCount > 0) {
      const simMini = simulateCandiesAndShards({
        lvNow, lvTarget, typeKey, natureKey,
        progressExp,
        boostKind: "mini",      // EXP×2 / かけら×4
        boostCount: miniCount,
      });
      html.push(subTitle(`ミニアメブースト時（EXP×2 / かけら×4）`));
      html.push(row("必要なアメの数", `${Math.max(0, simMini.candiesTotal - candyOwned).toLocaleString()} 個`));
      html.push(row("必要なゆめのかけら量", `${simMini.shardsTotal.toLocaleString()} 個`));
    }

    showResult(html.join(""));
  }

  function bindOnce() {
    el("lvCalc")?.addEventListener("click", onCalc);
    el("lvClear")?.addEventListener("click", clearAll);

    // 任意だけ消すクリア
    el("lvClearOptional")?.addEventListener("click", clearOptionalOnly);

    bindQuickButtons();
    bindExclusiveInputs();

    // 入力欄を範囲内に寄せる（入力中の暴走防止）
    clampIntoInput(el("lvNow"), 1, 64);
    clampIntoInput(el("lvTarget"), 2, 65);
    // 任意は「空=未入力」を許すので、ここでは強制clampしない（min=1が邪魔になるため）
    clampIntoInput(el("lvBoostCount"), 0, 9999);
    clampIntoInput(el("lvMiniBoostCount"), 0, 9999);
  }

  window.LevelTab = {
    init() {
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    },
  };

})();
