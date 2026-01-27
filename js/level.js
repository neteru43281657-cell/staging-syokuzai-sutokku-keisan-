"use strict";

(function () {
  // =========================
  // 設定（仕様確定版）
  // =========================
  const LV_MIN = 1;
  const LV_MAX = 65;

  const EXP_TYPE_MULT = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };

  // アメ1個あたりの基礎EXP（レベル帯 × 性格）
  // ※ここは「表の値」を使い、さらに性格の追加係数を掛ける（ユーザー指定）
  function baseCandyExp(level, nature) {
    // レベル帯
    // Lv1〜25 / Lv25〜30 / Lv30以上
    // ※Lv25は「25〜30帯」に含める（ユーザー入力上 “25/30ボタン”があるので自然）
    let band;
    if (level < 25) band = "1_25";
    else if (level < 30) band = "25_30";
    else band = "30_plus";

    const table = {
      "1_25": { none: 35, up: 41, down: 29 },
      "25_30": { none: 30, up: 35, down: 25 },
      "30_plus": { none: 25, up: 30, down: 21 },
    };

    const base = table[band][nature] ?? table[band].none;

    // 追加補正（ユーザー確定）
    // EXP↑：さらに 0.82倍（=より育ちやすい）
    // EXP↓：さらに 1.18倍（=より育ちにくい）
    const extra =
      nature === "up" ? 0.82 :
      nature === "down" ? 1.18 :
      1.0;

    return base * extra;
  }

  // =========================
  // テーブル読み込み
  // =========================
  let expTable = null;   // nextLevel -> exp (base)
  let shardTable = null; // level -> shard per candy

  async function loadTablesOnce() {
    if (expTable && shardTable) return;

    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then((r) => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then((r) => r.text()),
    ]);

    expTable = parseTwoColTable(expTxt);     // "2 54" 形式
    shardTable = parseTwoColTable(shardTxt); // "1 14" 形式
  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s) return;
      // コメント・ヘッダっぽい行は捨てる
      if (s.startsWith("#")) return;
      const parts = s.split(/\s+/);
      if (parts.length < 2) return;

      const k = Number(parts[0]);
      const v = Number(parts[1]);
      if (!Number.isFinite(k) || !Number.isFinite(v)) return;

      map.set(k, v);
    });
    return map;
  }

  // =========================
  // 計算コア
  // =========================
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function ceilDiv(a, b) {
    if (b <= 0) return Infinity;
    return Math.ceil(a / b);
  }

  // 「今のLv→目標Lv」までの累計必要EXP（タイプ倍率込み）
  function calcTotalNeedExp(lvNow, lvTarget, typeKey) {
    const mult = EXP_TYPE_MULT[typeKey] ?? 1.0;
    let sum = 0;

    for (let to = lvNow + 1; to <= lvTarget; to++) {
      const base = expTable.get(to);
      if (!base) {
        throw new Error(`EXP tableにLv${to}が見つかりません`);
      }
      sum += base * mult;
    }
    return Math.round(sum);
  }

  // レベルアップを「低レベルから順に」シミュレートして、
  // 必要アメ数と必要かけらを出す（ブースト対応）
  function simulateCandiesAndShards(opts) {
    const {
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      progressExp,     // 今Lv→次Lv に貯まっているEXP
      boostKind,       // "none" | "mini" | "full"
      boostCount,      // ブースト対象アメ数（最初から順に使う）
    } = opts;

    const mult = EXP_TYPE_MULT[typeKey] ?? 1.0;

    let candiesTotal = 0;
    let shardsTotal = 0;

    let boostRemain = Math.max(0, Number(boostCount) || 0);

    const boostExpMul = boostKind === "mini" || boostKind === "full" ? 2 : 1;
    const boostShardMul = boostKind === "mini" ? 4 : (boostKind === "full" ? 5 : 1);

    for (let lv = lvNow; lv < lvTarget; lv++) {
      const nextLv = lv + 1;

      let stepNeed = (expTable.get(nextLv) || 0) * mult;
      stepNeed = Math.round(stepNeed);

      // 最初の1段だけ「次Lvまでの溜まりEXP」を差し引く
      if (lv === lvNow && progressExp > 0) {
        stepNeed = Math.max(0, stepNeed - progressExp);
      }

      if (stepNeed <= 0) continue;

      // このレベルでの「通常アメ1個あたりEXP」
      const perCandy = baseCandyExp(lv, natureKey);

      // このレベルでの「アメ1個あたりかけら」
      const shardPer = shardTable.get(lv) || 0;

      let remainExp = stepNeed;

      // まずブースト分を可能なら使う（低レベルから順）
      if (boostRemain > 0 && boostKind !== "none") {
        const perBoostCandyExp = perCandy * boostExpMul;

        // この段をブーストだけで満たすなら何個必要か
        const needBoostCandies = ceilDiv(remainExp, perBoostCandyExp);

        const useBoost = Math.min(boostRemain, needBoostCandies);

        candiesTotal += useBoost;
        shardsTotal += useBoost * shardPer * boostShardMul;

        remainExp -= useBoost * perBoostCandyExp;
        boostRemain -= useBoost;
      }

      // 残りは通常アメで満たす
      if (remainExp > 0) {
        const needNormal = ceilDiv(remainExp, perCandy);
        candiesTotal += needNormal;
        shardsTotal += needNormal * shardPer; // 通常倍率

        remainExp = 0;
      }
    }

    return {
      candiesTotal: Math.trunc(candiesTotal),
      shardsTotal: Math.trunc(Math.round(shardsTotal)),
    };
  }

  // =========================
  // UI
  // =========================
  function el(id) { return document.getElementById(id); }

  function getRadio(name) {
    const c = document.querySelector(`input[name="${name}"]:checked`);
    return c ? c.value : null;
  }

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

  function buildResultRow(key, val) {
    return `<div class="lvResRow"><div class="lvResKey">${key}</div><div class="lvResVal">${val}</div></div>`;
  }

  async function onCalc() {
    hideResult();

    // 入力取得
    const lvNow = clampInt(el("lvNow")?.value, LV_MIN, LV_MAX);
    const lvTarget = clampInt(el("lvTarget")?.value, 2, LV_MAX);

    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";

    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);

    const boost = clampInt(el("lvBoost")?.value || 0, 0, 999);
    const mini = clampInt(el("lvMiniBoost")?.value || 0, 0, 999);

    // バリデーション
    const errs = [];
    if (!lvNow) errs.push("今のレベルを入力してください");
    if (!lvTarget) errs.push("目標レベルを入力してください");
    if (lvTarget <= lvNow) errs.push("目標レベルは「今のレベル」より大きくしてください");

    if (boost > 0 && mini > 0) errs.push("ミニアメブースト と アメブースト は同時に入力できません");

    if (errs.length) {
      showResult(`<div class="lvResTitle">入力エラー</div><div class="lvlWarn">${errs.join("<br>")}</div>`);
      return;
    }

    await loadTablesOnce();

    // ① 必要経験値（累計）→ progress を差し引いた「残り必要経験値」
    const totalNeedExp = calcTotalNeedExp(lvNow, lvTarget, typeKey);
    const remainNeedExp = Math.max(0, totalNeedExp - progressExp);

    // ② ブースト指定
    let boostKind = "none";
    let boostCount = 0;
    if (mini > 0) { boostKind = "mini"; boostCount = mini; }
    if (boost > 0) { boostKind = "full"; boostCount = boost; }

    // ③ アメ数＆かけら：progress を考慮した上でシミュレーション
    const sim = simulateCandiesAndShards({
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      progressExp,
      boostKind,
      boostCount,
    });

    // ④ 所持アメで差し引き（負なら0）
    const candiesNeedAfterOwned = Math.max(0, sim.candiesTotal - candyOwned);

    // 表示
    const html = [
      `<div class="lvResTitle">計算結果</div>`,
      buildResultRow("必要経験値（累計）", `${totalNeedExp.toLocaleString()} EXP`),
      buildResultRow("必要経験値（差引後）", `${remainNeedExp.toLocaleString()} EXP`),
      buildResultRow("必要なアメ数（合計）", `${sim.candiesTotal.toLocaleString()} 個`),
      buildResultRow("必要なアメ数（所持分差引後）", `${candiesNeedAfterOwned.toLocaleString()} 個`),
      buildResultRow("必要なゆめのかけら量", `${sim.shardsTotal.toLocaleString()} 個`),
    ].join("");

    showResult(html);
  }

  function onClear() {
    ["lvNow","lvTarget","lvProgressExp","lvCandyOwned","lvBoost","lvMiniBoost"].forEach((id) => {
      const x = el(id);
      if (x) x.value = "";
    });

    const n0 = document.querySelector(`input[name="lvNature"][value="none"]`);
    const t0 = document.querySelector(`input[name="lvType"][value="normal"]`);
    if (n0) n0.checked = true;
    if (t0) t0.checked = true;

    hideResult();
  }

  function bindOnce() {
    const calcBtn = el("lvCalc");
    const clearBtn = el("lvClear");
    if (calcBtn) calcBtn.onclick = onCalc;
    if (clearBtn) clearBtn.onclick = onClear;

    // 25/30/50/60 ボタン
    document.querySelectorAll(".lvlQuickBtn").forEach((b) => {
      b.onclick = () => {
        const v = Number(b.dataset.lv);
        const t = el("lvTarget");
        if (t) t.value = String(v);
      };
    });

    // ブースト同時入力禁止：入力時に片方を自動クリア
    const boost = el("lvBoost");
    const mini = el("lvMiniBoost");
    if (boost && mini) {
      boost.addEventListener("input", () => {
        if (Number(boost.value) > 0) mini.value = "";
      });
      mini.addEventListener("input", () => {
        if (Number(mini.value) > 0) boost.value = "";
      });
    }
  }

  // public
  window.LevelTab = {
    init: function () {
      // 何度呼ばれても問題ないように軽く
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    },
  };
})();
