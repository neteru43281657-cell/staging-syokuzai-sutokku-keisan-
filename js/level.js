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
  
    // 正確な境界判定：
    // Lv1～24（25になるまで）: 35
    // Lv25～29（30になるまで）: 30
    // Lv30以上: 25
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

  // データを一度だけ読み込むための関数（エラーの原因となっていた箇所）
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
   * Utilities & Table Loader
   * ========================= */
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

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

  /* =========================
   * Core Logic
   * ========================= */

  function baseCandyExp(level, nature) {
    let band;
    // 境界値：25になるまで(1-24), 30になるまで(25-29), 30以上
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

  function simulateCandiesAndShards(opts) {
    const {
      lvNow, lvTarget, typeKey, natureKey,
      progressExp, boostKind, boostCount,
    } = opts;

    let candies = 0;
    let shards = 0;
    let lv = lvNow;
    
    // 現在のレベル内での獲得済み経験値を算出
    const rowForNext = expTable.get(lv + 1);
    const needForNext = rowForNext ? (typeof rowForNext === "number" ? rowForNext : (rowForNext[typeKey] ?? rowForNext.normal)) : 0;
    
    // 「あと何ptでレベルアップか」から「現在何pt持っているか」を逆算
    let currentExp = 0;
    if (progressExp > 0 && progressExp < needForNext) {
      currentExp = needForNext - progressExp;
    }

    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = (boostKind === "none") ? 1 : 2;
    const boostShardMul = (boostKind === "mini") ? 4 : (boostKind === "full" ? 5 : 1);

    // 目標レベルに達するまでループ
    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const row = expTable.get(targetLv);
      if (!row) break;

      const expRequiredForThisLevel = typeof row === "number" ? row : (row[typeKey] ?? row.normal);

      // そのレベルを突破するまでアメを1個ずつ消費
      while (currentExp < expRequiredForThisLevel) {
        const useBoost = (boostRemain > 0 && boostKind !== "none");
        
        // アメ1個の獲得量と消費かけら
        const gain = Math.floor(baseCandyExp(lv, natureKey) * (useBoost ? boostExpMul : 1));
        const shardCost = (shardTable.get(targetLv) || 0) * (useBoost ? boostShardMul : 1);

        candies++;
        shards += shardCost;
        currentExp += gain;
        
        if (useBoost) boostRemain--;
      }

      // レベルアップ処理（余剰経験値を持ち越す）
      currentExp -= expRequiredForThisLevel;
      lv++;
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

  // ===== 入力桁数を強制（type=numberでも8桁入力できてしまう対策）=====
  function enforceDigits(el, maxDigits) {
    if (!el) return;
  
    el.addEventListener("input", () => {
      // numberでも "e" や "+" が入ることがあるので数字以外を除去
      let v = String(el.value ?? "").replace(/[^\d]/g, "");
  
      // 桁数制限
      if (v.length > maxDigits) v = v.slice(0, maxDigits);
  
      // max属性も尊重（念のため）
      const maxAttr = el.getAttribute("max");
      if (maxAttr) {
        const maxNum = parseInt(maxAttr, 10);
        const nowNum = v === "" ? NaN : parseInt(v, 10);
        if (!Number.isNaN(nowNum) && nowNum > maxNum) v = String(maxNum);
      }
  
      el.value = v;
    });
  }
  
  // ★ 桁数制限したい項目
  enforceDigits(document.getElementById("lvProgressExp"), 4);
  enforceDigits(document.getElementById("lvCandyOwned"), 4);
  enforceDigits(document.getElementById("lvBoostCount"), 4);
  enforceDigits(document.getElementById("lvMiniBoostCount"), 4);
  enforceDigits(document.getElementById("lvNow"), 2);
  enforceDigits(document.getElementById("lvTarget"), 2);
  
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
    // 既存の「個別 addEventListener」をやめて、親でまとめて拾う（PCでも安定）
    const root = document.getElementById("tab3") || document;
  
    // 値を入れた後、input/change を発火して「桁数制限」なども確実に走らせる
    const setVal = (inputEl, v) => {
      if (!inputEl) return;
      inputEl.value = String(v);
  
      // inputイベント（enforceDigitsやUI更新のため）
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    };
  
    root.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".lvlQuickBtn");
      if (!btn) return;
  
      // ボタンの意図しない挙動を止める
      e.preventDefault();
  
      // 今のレベル
      if (btn.dataset.now != null) {
        const v = Number(btn.dataset.now);
        if (Number.isFinite(v) && v >= 1 && v <= 64) {
          setVal(el("lvNow"), v);
        }
        return;
      }
  
      // 目標レベル
      if (btn.dataset.target != null) {
        const v = Number(btn.dataset.target);
        if (Number.isFinite(v) && v >= 2 && v <= 65) {
          setVal(el("lvTarget"), v);
        }
        return;
      }
  
      // アメブースト（入力したらミニは0にする：択一）
      if (btn.dataset.boost != null) {
        const v = Number(btn.dataset.boost);
        if (Number.isFinite(v) && v >= 0 && v <= 9999) {
          setVal(el("lvBoostCount"), v);
          if (v > 0) setVal(el("lvMiniBoostCount"), 0);
        }
        return;
      }
  
      // ミニアメブースト（入力したらアメブーストは0にする：択一）
      if (btn.dataset.mini != null) {
        const v = Number(btn.dataset.mini);
        if (Number.isFinite(v) && v >= 0 && v <= 9999) {
          setVal(el("lvMiniBoostCount"), v);
          if (v > 0) setVal(el("lvBoostCount"), 0);
        }
        return;
      }
    }, { passive: false });
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
  
    const nowRaw = (el("lvNow")?.value ?? "").trim();
    const targetRaw = (el("lvTarget")?.value ?? "").trim();
  
    // ★ 何も入力していない（必須が空）の場合は何も出力しない
    if (!nowRaw || !targetRaw) return;
  
    const lvNow = clampInt(nowRaw, LV_MIN, LV_MAX);      // 1〜64
    const lvTarget = clampInt(targetRaw, 2, LV_MAX);     // 2〜65
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
    html.push(row("必要経験値", `${totalExp.toLocaleString()} pt`));
    html.push(row("必要なアメの数", `${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個`));
    html.push(row("必要なゆめのかけら量", `${simNormal.shardsTotal.toLocaleString()} `));

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
      html.push(row("必要なゆめのかけら量", `${simBoost.shardsTotal.toLocaleString()} `));
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
      html.push(row("必要なゆめのかけら量", `${simMini.shardsTotal.toLocaleString()} `));
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











