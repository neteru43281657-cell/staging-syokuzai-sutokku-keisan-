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
      // 内部的には Normal(ふつう) 列のみを正として使用し、他は倍率計算する
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

    // 累計（Normal）を算出
    const cumNormal = [0];
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }

    // 他タイプ：累計に倍率をかけて四捨五入し、その差分を取る（誤差蓄積防止）
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

  /* =========================
   * DOM helpers & Guard
   * ========================= */
  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    let digits = input.value.replace(/[^\d]/g, "");
    if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
    if (digits !== "") {
      let v = Math.max(min, Math.min(max, parseInt(digits, 10)));
      // 入力中の利便性のため、末尾が0などの場合に強制上書きしないよう配慮
      if (input.value !== String(v)) input.value = String(v);
    }
  }

  /* =========================
   * EXP per candy
   * ========================= */
  function getCandyExp(level, natureKey, boostMul) {
    let base = level < 25 ? 35 : (level < 30 ? 30 : 25);
    let natureMul = natureKey === "up" ? 1.18 : (natureKey === "down" ? 0.82 : 1.0);
    // 性格補正をかけて四捨五入してからブースト倍率をかける（仕様）
    return Math.round(base * natureMul) * boostMul;
  }

  /* =========================
   * Simulator
   * ========================= */
  function simulateCandiesAndShards(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, initialProgress, freeExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
    let currentExp = initialProgress + freeExp;
    let boostRemain = Math.max(0, boostCount);
    
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
    // 各項目の最小値を「0」に修正（ここがズレの最大の原因）
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvCandyOwned"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvBoostCount"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvSleepDays"), 3, 0, 999);
    enforceDigitsAndRange(el("lvSleepBonus"), 1, 0, 5);
    enforceDigitsAndRange(el("lvGrowthIncense"), 3, 0, 999);

    const nowRaw = el("lvNow")?.value.trim();
    const targetRaw = el("lvTarget")?.value.trim();
    const natureSel = getRadio("lvNature");
    const typeSel = getRadio("lvType");

    if (!nowRaw || !targetRaw || !natureSel || !typeSel) {
      const box = el("lvResult");
      if (box) box.style.display = "none";
      return;
    }

    const lvNow = parseInt(nowRaw, 10);
    const lvTarget = parseInt(targetRaw, 10);

    if (lvTarget <= lvNow) {
      el("lvResult").innerHTML = `<div class="lvResTitle">計算結果</div><div style="color:red; font-size:12px; font-weight:bold;">目標のレベルは今のレベルより大きい値にしてください</div>`;
      el("lvResult").style.display = "block";
      return;
    }

    await loadTablesOnce();

    const progressExp = toNum(el("lvProgressExp")?.value);
    const candyOwned = toNum(el("lvCandyOwned")?.value);
    const boostKind = getRadio("lvBoostKind") || "none";
    let boostCountEff = boostCountTouched ? toNum(el("lvBoostCount")?.value) : 9999;

    const sleepDays = toNum(el("lvSleepDays")?.value);
    const sleepBonus = toNum(el("lvSleepBonus")?.value);
    const incense = toNum(el("lvGrowthIncense")?.value);

    // 進捗（次のレベルまでに必要な残りの量）を「既に稼いだ量」に変換
    let initialProgress = Math.max(0, getNeedStep(lvNow + 1, typeSel) - progressExp);

    // 総必要EXP（単純合計）
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, typeSel);

    // freeExp (睡眠) の計算：linear方式（おこうは日数分のみ倍増）に修正
    let usedIncense = Math.min(sleepDays, incense);
    let perDayBase = 100 + 14 * sleepBonus;
    let freeExp = perDayBase * (sleepDays + usedIncense);
    freeExp = Math.min(freeExp, totalSteps);

    const totalExpNeeded = Math.max(0, totalSteps - initialProgress - freeExp);

    // シミュレーション実行
    const simNormal = simulateCandiesAndShards({ lvNow, lvTarget, typeKey: typeSel, natureKey: natureSel, initialProgress, freeExp, boostKind: "none", boostCount: 0 });

    let html = `<div id="lvResultClear" class="lvResultClose">×</div><div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    if (boostKind !== "none") {
      const simBoost = simulateCandiesAndShards({ lvNow, lvTarget, typeKey: typeSel, natureKey: natureSel, initialProgress, freeExp, boostKind, boostCount: boostCountEff });
      const subtitle = boostKind === "mini" ? "ミニアメブースト時" : "アメブースト時";
      html += `<div class="lvResSubTitle">${subtitle}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }

    el("lvResult").innerHTML = html;
    el("lvResult").style.display = "block";
    el("lvResultClear").onclick = LevelTab.clearAll;
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
        if (btn.dataset.now) el("lvNow").value = btn.dataset.now;
        if (btn.dataset.target) el("lvTarget").value = btn.dataset.target;
        onCalc();
      }
    });
  }

  window.LevelTab = {
    init() { if (!window.__LV_BOUND__) { window.__LV_BOUND__ = true; bindOnce(); } onCalc(); },
    clearAll() {
      ["lvNow", "lvTarget", "lvProgressExp", "lvCandyOwned", "lvBoostCount", "lvSleepDays", "lvSleepBonus", "lvGrowthIncense"].forEach(id => {
        const x = el(id); if (x) x.value = "";
      });
      document.querySelectorAll('#tab3 input[type="radio"]').forEach(r => {
        r.checked = (r.value === "none" || r.value === "normal");
      });
      boostCountTouched = false;
      onCalc();
    }
  };
})();
