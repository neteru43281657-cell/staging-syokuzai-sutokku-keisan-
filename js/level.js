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
  let needStepCache = null; // Map<typeKey, Map<targetLv, needStep>>
  let boostCountTouched = false;

  async function loadTablesOnce() {
    if (expTable && shardTable) return;
    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then(r => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then(r => r.text()),
    ]);
    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);
    buildNeedStepCache();
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
      map.set(lv, { normal: toNum(p[1]) });
    });
    return map;
  }

  /* =========================
   * 必要EXP（タイプ倍率）算出：累計→丸め→差分
   * ========================= */
  const TYPE_MUL = { normal: 1.0, "600": 1.5, semi: 1.8, legend: 2.2 };

  function buildNeedStepCache() {
    if (!expTable) return;
    needStepCache = new Map();

    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) {
      normalMap.set(lv, expTable.get(lv)?.normal || 0);
    }
    needStepCache.set("normal", normalMap);

    const cumNormal = [0];
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }

    ["600", "semi", "legend"].forEach(typeKey => {
      const mul = TYPE_MUL[typeKey];
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
    const m = needStepCache?.get(typeKey) || needStepCache?.get("normal");
    return m ? (m.get(targetLv) || 0) : 0;
  }

  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    let digits = input.value.replace(/[^\d]/g, "");
    if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
    if (digits !== "") {
      let v = Math.max(min, Math.min(max, parseInt(digits, 10)));
      if (input.value !== String(v)) input.value = String(v);
    }
  }

  function getCandyExp(level, natureKey, boostMul) {
    let base = level < 25 ? 35 : (level < 30 ? 30 : 25);
    let natureMul = natureKey === "up" ? 1.18 : (natureKey === "down" ? 0.82 : 1.0);
    return Math.round(base * natureMul) * boostMul;
  }

  function simulateCandiesAndShards(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, initialProgress, freeExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
    let currentExp = (initialProgress || 0) + (freeExp || 0);
    let boostRemain = Math.max(0, boostCount || 0);

    const boostExpMul = 2;
    const boostShardMul = boostKind === "mini" ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const needStep = getNeedStep(targetLv, typeKey);

      while (currentExp < needStep) {
        const useBoost = (boostKind !== "none" && boostRemain > 0);
        const bMul = useBoost ? boostExpMul : 1;
        const sMul = useBoost ? boostShardMul : 1;

        candies++;
        shards += (shardTable.get(targetLv) || 0) * sMul;
        currentExp += getCandyExp(lv, natureKey, bMul);
        if (useBoost) boostRemain--;
      }
      currentExp -= needStep;
      lv++;
    }
    return { candiesTotal: candies, shardsTotal: shards };
  }

  async function onCalc() {
    await loadTablesOnce();

    // 入力制限（桁・範囲）
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvCandyOwned"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvBoostCount"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvSleepDays"), 3, 0, 999);
    enforceDigitsAndRange(el("lvSleepBonus"), 1, 0, 5);
    enforceDigitsAndRange(el("lvGrowthIncense"), 3, 0, 999);

    const lvNow = toNum(el("lvNow")?.value);
    let lvTarget = toNum(el("lvTarget")?.value);

    const nowRaw = el("lvNow")?.value.trim();
    const targetRaw = el("lvTarget")?.value.trim();
    const natureSel = getRadio("lvNature");
    const typeSel = getRadio("lvType");

    if (!nowRaw || !targetRaw || !natureSel || !typeSel) {
      el("lvResult").innerHTML = `<div id="lvResultClear" class="lvResultClose">×</div><div class="lvResTitle">計算結果</div>`;
      el("lvResultClear").onclick = clearAll;
      return;
    }

    // 現在Lvが目標Lvを超えた場合のみ、目標Lvを引き上げる
    if (lvNow > 0 && lvTarget > 0 && lvNow > lvTarget) {
      el("lvTarget").value = String(lvNow);
      lvTarget = lvNow;
    }

    const progressExpInput = toNum(el("lvProgressExp")?.value); // 「すでに稼いだEXP」として扱う
    const candyOwned = toNum(el("lvCandyOwned")?.value);

    const boostKind = getRadio("lvBoostKind") || "none";
    let boostCountEff = boostCountTouched ? toNum(el("lvBoostCount")?.value) : 9999;

    // ------- 睡眠/おこう（上限処理：おこう <= 睡眠日数） -------
    const sleepEl = el("lvSleepDays");
    const incenseEl = el("lvGrowthIncense");
    const sleepRaw = sleepEl?.value.trim() ?? "";
    const incenseRaw = incenseEl?.value.trim() ?? "";

    const sleepDays = toNum(sleepEl?.value);
    const sleepBonus = toNum(el("lvSleepBonus")?.value);
    let incense = toNum(incenseEl?.value);

    // 「睡眠」が入力されている状態で、おこうが睡眠を超えたらクランプ（=②の要望）
    if (sleepRaw !== "" && incenseRaw !== "" && incense > sleepDays) {
      incenseEl.value = String(sleepDays);
      incense = sleepDays;
    }

    // ------- 必要EXP -------
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, typeSel);

    // progressExp は「必要経験値」表示から引く（UI要件）
    const progressExpUsedForTotal = Math.min(progressExpInput, totalSteps);

    // シミュレーションの初期所持EXP（次レベル必要EXPを上限にして繰り越さない）
    const needForNext = getNeedStep(lvNow + 1, typeSel);
    const initialProgress = Math.min(progressExpInput, needForNext);

    // ------- freeExp（睡眠/おこう） -------
    // 正：睡眠EXPボーナスはおこう無しの日も常に加算（毎日 100+14*n）
    // おこうを使った日はその日の睡眠EXPが *2
    const perDay = 100 + 14 * sleepBonus;

    const usedIncense = Math.min(sleepDays, incense);           // おこう使用日数（睡眠日数以下）
    const nonIncenseDays = Math.max(0, sleepDays - usedIncense); // おこう無しの日数

    let freeExp =
      (perDay * 2 * usedIncense) +
      (perDay * nonIncenseDays);

    // freeExp は残り必要分以上は使えない
    const remainAfterProgress = Math.max(0, totalSteps - progressExpUsedForTotal);
    freeExp = Math.min(freeExp, remainAfterProgress);

    // 表示用：必要経験値（progressExp と freeExp を差し引く）
    const totalExpNeeded = Math.max(0, totalSteps - progressExpUsedForTotal - freeExp);

    // ------- シミュレーション実行（アメ/かけら） -------
    const simNormal = simulateCandiesAndShards({
      lvNow,
      lvTarget,
      typeKey: typeSel,
      natureKey: natureSel,
      initialProgress,
      freeExp,
      boostKind: "none",
      boostCount: 0
    });

    const shardLabelHtml = `
      <div class="lvResKey">
        必要なゆめのかけら量✨
        <div style="font-size: 0.7em; font-weight: normal; margin-top: 2px;">└ 近似値で出る場合があります</div>
      </div>`;

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow">${shardLabelHtml}<div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    if (boostKind !== "none") {
      const simBoost = simulateCandiesAndShards({
        lvNow,
        lvTarget,
        typeKey: typeSel,
        natureKey: natureSel,
        initialProgress,
        freeExp,
        boostKind,
        boostCount: boostCountEff
      });
      const subtitle = boostKind === "mini" ? "ミニアメブースト時" : "アメブースト時";
      html += `<div class="lvResSubTitle">${subtitle}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow">${shardLabelHtml}<div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }

    el("lvResult").innerHTML = `<div id="lvResultClear" class="lvResultClose">×</div>` + html;
    el("lvResultClear").onclick = clearAll;
  }

  function clearAll() {
    ["lvNow", "lvTarget", "lvProgressExp", "lvCandyOwned", "lvBoostCount", "lvSleepDays", "lvSleepBonus", "lvGrowthIncense"].forEach(id => {
      const x = el(id); if (x) x.value = "";
    });
    document.querySelectorAll('#tab3 input[type="radio"]').forEach(r => {
      r.checked = (r.value === "none" || r.value === "normal");
    });
    boostCountTouched = false;
    el("lvResult").innerHTML = `<div id="lvResultClear" class="lvResultClose">×</div><div class="lvResTitle">計算結果</div>`;
    el("lvResultClear").onclick = clearAll;
  }

  function bindOnce() {
    const tab3 = document.getElementById("tab3");
    if (!tab3) return;

    tab3.addEventListener("input", e => {
      if (e.target.id === "lvBoostCount") boostCountTouched = true;
      onCalc();
    });
    tab3.addEventListener("change", onCalc);
    tab3.addEventListener("click", e => {
      const btn = e.target.closest(".lvlQuickBtn");
      if (btn) {
        // datasetの存在チェックを行い、該当する項目だけを更新するように修正
        if (btn.dataset.now !== undefined) {
          el("lvNow").value = btn.dataset.now;
        } else if (btn.dataset.target !== undefined) {
          el("lvTarget").value = btn.dataset.target;
        }
        onCalc();
      }
      if (e.target.id === "lvResultClear") clearAll();
    });
  }

  window.LevelTab = { init() { if (!window.__LV_BOUND__) { window.__LV_BOUND__ = true; bindOnce(); } onCalc(); } };
})();
