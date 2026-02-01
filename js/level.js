"use strict";

/**
 * 数値変換ヘルパー
 */
function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

(function () {
  let expTable = null;
  let shardTable = null;
  let needStepCache = null;
  let boostCountTouched = false;

  /**
   * データテーブルの読み込み
   */
  async function loadTablesOnce() {
    if (expTable && shardTable) return;
    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then((r) => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then((r) => r.text()),
    ]);
    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);
    buildNeedStepCache();
  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const p = s.split(/\s+/);
      if (p.length < 2) return;
      map.set(Number(p[0]), toNum(p[1]));
    });
    return map;
  }

  function parseExpTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach((line) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const p = s.split(/\s+/);
      if (p.length < 2) return;
      map.set(Number(p[0]), { normal: toNum(p[1]) });
    });
    return map;
  }

  // 経験値タイプの倍率定義
  const TYPE_MUL = { normal: 1.0, "600": 1.5, semi: 1.8, legend: 2.2 };

  /**
   * 必要経験値キャッシュの構築
   */
  function buildNeedStepCache() {
    if (!expTable) return;
    needStepCache = new Map();
    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) {
      const row = expTable.get(lv);
      normalMap.set(lv, row ? toNum(row.normal) : 0);
    }
    needStepCache.set("normal", normalMap);
    const cumNormal = [0];
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }
    ["600", "semi", "legend"].forEach((typeKey) => {
      const mul = TYPE_MUL[typeKey] || 1.0;
      const map = new Map();
      let prevScaled = 0;
      for (let lv = 2; lv <= 65; lv++) {
        const scaledCum = Math.round((cumNormal[lv] || 0) * mul);
        map.set(lv, scaledCum - prevScaled);
        prevScaled = scaledCum;
      }
      needStepCache.set(typeKey, map);
    });
  }

  function getNeedStep(targetLv, typeKey) {
    if (!needStepCache) buildNeedStepCache();
    return needStepCache.get(typeKey)?.get(targetLv) || 0;
  }

  const el = (id) => document.getElementById(id);
  const getRadio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  /**
   * 入力バリデーション
   */
  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    let v = input.value.replace(/[^\d]/g, "");
    if (v.length > maxDigits) v = v.slice(0, maxDigits);
    if (v !== "") {
      let num = Math.max(min, Math.min(max, parseInt(v, 10)));
      input.value = String(num);
    }
  }

  /**
   * お香やGSDの回数を睡眠日数に合わせる
   */
  function clampSubOptions() {
    const sleep = toNum(el("lvSleepDays").value);
    const incEl = el("lvGrowthIncense");
    const gsdEl = el("lvGSD");
    if (toNum(incEl.value) > sleep) incEl.value = sleep || "";
    if (toNum(gsdEl.value) > sleep) gsdEl.value = sleep || "";
  }

  /**
   * アメ1個あたりの獲得経験値計算
   */
  function getCandyExp(level, natureKey, boostMul) {
    let base = level < 25 ? 35 : (level < 30 ? 30 : 25);
    let natureMul = natureKey === "up" ? 1.18 : (natureKey === "down" ? 0.82 : 1.0);
    return Math.round(base * natureMul) * boostMul;
  }

  /**
   * 睡眠等による無料獲得経験値計算
   */
  function calculateFreeExp() {
    const sleep = toNum(el("lvSleepDays").value);
    const bonusCount = toNum(el("lvSleepBonus").value);
    const incense = toNum(el("lvGrowthIncense").value);
    const gsdCount = toNum(el("lvGSD").value);
    const baseExp = 100 + (14 * bonusCount);
    
    let remDays = sleep;
    let gsd3Days = Math.min(remDays, gsdCount);
    remDays -= gsd3Days;
    let gsd2Days = Math.min(remDays, gsdCount * 2);
    remDays -= gsd2Days;
    let normalDays = remDays;

    let remainIncense = incense;
    const useIncense = (days, multiplier) => {
      const daysWithIncense = Math.min(days, remainIncense);
      remainIncense -= daysWithIncense;
      return (daysWithIncense * baseExp * multiplier * 2) + ((days - daysWithIncense) * baseExp * multiplier);
    };

    let total = 0;
    total += useIncense(gsd3Days, 3);
    total += useIncense(gsd2Days, 2);
    total += useIncense(normalDays, 1);
    return total;
  }

  /**
   * シミュレーション本体
   */
  function simulate(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, initialProgress, freeExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
    
    // 今のレベルでの蓄積EXP + 睡眠EXPからスタート
    let currentExp = initialProgress + freeExp;
    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = 2;
    const boostShardMul = boostKind === "mini" ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const step = getNeedStep(lv + 1, typeKey);
      while (currentExp < step) {
        const useB = boostKind !== "none" && boostRemain > 0;
        candies++;
        shards += (shardTable.get(lv + 1) || 0) * (useB ? boostShardMul : 1);
        currentExp += getCandyExp(lv, natureKey, useB ? boostExpMul : 1);
        if (useB) boostRemain--;
      }
      currentExp -= step;
      lv++;
    }
    return { candies, shards };
  }

  /**
   * メイン計算処理
   */
  async function onCalc() {
    // バリデーション
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvOwnedCandy"), 4, 0, 9999); // 所持アメ数
    enforceDigitsAndRange(el("lvBoostCount"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvSleepDays"), 3, 0, 999);
    enforceDigitsAndRange(el("lvSleepBonus"), 1, 0, 5);
    enforceDigitsAndRange(el("lvGrowthIncense"), 3, 0, 999);
    enforceDigitsAndRange(el("lvGSD"), 2, 0, 99);
    clampSubOptions();

    const lvNow = toNum(el("lvNow").value);
    const lvTarget = toNum(el("lvTarget").value);
    const nature = getRadio("lvNature");
    const type = getRadio("lvType");
    const container = el("lvResultIn");

    // 必須入力チェック
    if (!lvNow || !lvTarget || !nature || !type) {
      container.innerHTML = `
        <div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">0 pt</div></div>
        <div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">0 個</div></div>
        <div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨<div style="font-size:0.75em; font-weight:800; margin-top:2px; opacity: 0.8;">└ 数十程度の誤差が出る場合があります</div></div><div class="lvResVal">0</div></div>`;
      return;
    }

    if (lvTarget <= lvNow) {
      container.innerHTML = `<div style="color:red; font-size:12px; font-weight:bold;">目標レベルを現在のレベルより大きくしてください</div>`;
      return;
    }

    await loadTablesOnce();

    // 初期進行状況の計算
    const needForNext = getNeedStep(lvNow + 1, type);
    const progressInput = toNum(el("lvProgressExp").value);
    const initialProgress = Math.max(0, needForNext - Math.min(progressInput || needForNext, needForNext));

    // 総必要EXPの計算（表示用）
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, type);
    const freeExp = calculateFreeExp();
    const displayExpNeeded = Math.max(0, totalSteps - (needForNext - Math.min(progressInput || needForNext, needForNext)) - freeExp);

    // ブースト設定
    const boostKind = getRadio("lvBoostKind") || "none";
    // 個数欄が空の場合は「すべてブースト」とみなして 9999 をセット
    const bCountStr = el("lvBoostCount").value;
    const bCount = (bCountStr === "") ? 9999 : toNum(bCountStr);

    // アメ所持数
    const ownedCandy = toNum(el("lvOwnedCandy").value);

    // 通常時の計算
    const resNormal = simulate({ lvNow, lvTarget, typeKey: type, natureKey: nature, initialProgress, freeExp, boostKind: "none", boostCount: 0 });
    const finalNormalCandy = Math.max(0, resNormal.candies - ownedCandy);

    let html = `
      <div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${displayExpNeeded.toLocaleString()} pt</div></div>
      <div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${finalNormalCandy.toLocaleString()} 個</div></div>
      <div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨<div style="font-size:0.75em; font-weight:800; margin-top:2px; opacity: 0.8;">└ 数十程度の誤差が出る場合があります</div></div><div class="lvResVal">${resNormal.shards.toLocaleString()}</div></div>`;

    // ブースト時の計算と差分表示
    if (boostKind !== "none") {
      const resBoost = simulate({ lvNow, lvTarget, typeKey: type, natureKey: nature, initialProgress, freeExp, boostKind, boostCount: bCount });
      
      const finalBoostCandy = Math.max(0, resBoost.candies - ownedCandy);
      
      // 差分の計算（通常必要分との比較）
      const diffCandy = resNormal.candies - resBoost.candies;
      const diffShard = resBoost.shards - resNormal.shards;

      // 文言の定義
      const boostTitle = boostKind === "mini" ? "ミニアメブースト時（EXP2倍 / かけら消費4倍）" : "アメブースト時（EXP2倍 / かけら消費5倍）";

      html += `<div class="lvResSubTitle">${boostTitle}</div>
               <div class="lvResRow">
                 <div class="lvResKey">必要なアメの数🍬</div>
                 <div class="lvResVal">${finalBoostCandy.toLocaleString()} 個 <span style="color:#007bff; font-size:0.9em;">(-${diffCandy.toLocaleString()})</span></div>
               </div>
               <div class="lvResRow">
                 <div class="lvResKey">必要なゆめのかけら量✨<div style="font-size:0.75em; font-weight:800; margin-top:2px; opacity: 0.8;">└ 数十程度の誤差が出る場合があります</div></div>
                 <div class="lvResVal">${resBoost.shards.toLocaleString()} <span style="color:#e74c3c; font-size:0.9em;">(+${diffShard.toLocaleString()})</span></div>
               </div>`;
    }
    container.innerHTML = html;
  }

  /**
   * LevelTab オブジェクト（外部から呼び出し用）
   */
  window.LevelTab = {
    init() {
      if (!window.__LV_BOUND__) {
        window.__LV_BOUND__ = true;
        // 入力があったら計算実行
        el("tab3").addEventListener("input", (e) => {
          if (e.target.id === "lvBoostCount") boostCountTouched = true;
          onCalc();
        });
        el("tab3").addEventListener("change", onCalc);
        // クイックボタンの処理
        el("tab3").addEventListener("click", (e) => {
          const btn = e.target.closest(".lvlQuickBtn");
          if (btn) {
            if (btn.dataset.now) el("lvNow").value = btn.dataset.now;
            if (btn.dataset.target) el("lvTarget").value = btn.dataset.target;
            onCalc();
          }
        });
        // 結果カードの×ボタン
        const closeBtn = el("lvResultClear");
        if (closeBtn) closeBtn.onclick = () => this.clearAll();
      }
      onCalc();
    },
    /**
     * すべてクリア
     */
    clearAll() {
      ["lvNow", "lvTarget", "lvProgressExp", "lvOwnedCandy", "lvBoostCount", "lvSleepDays", "lvSleepBonus", "lvGrowthIncense", "lvGSD"].forEach(id => {
        const target = el(id);
        if (target) target.value = "";
      });
      document.querySelectorAll('input[name="lvNature"], input[name="lvType"], input[name="lvBoostKind"]').forEach(r => r.checked = false);
      boostCountTouched = false;
      onCalc();
    }
  };
})();
