"use strict";

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

  const TYPE_MUL = { normal: 1.0, "600": 1.5, semi: 1.8, legend: 2.2 };
  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  async function loadTablesOnce() {
    if (expTable && shardTable) return;
    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt").then(r => r.text()),
      fetch("./data/shard_table.txt").then(r => r.text()),
    ]);
    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);
    buildNeedStepCache();
  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\n/).forEach(line => {
      const p = line.trim().split(/\s+/);
      if (p.length >= 2) map.set(Number(p[0]), toNum(p[1]));
    });
    return map;
  }

  function parseExpTable(txt) {
    const map = new Map();
    txt.split(/\n/).forEach(line => {
      const p = line.trim().split(/\s+/);
      if (p.length >= 2) map.set(Number(p[0]), { normal: toNum(p[1]), "600": toNum(p[2]), semi: toNum(p[3]), legend: toNum(p[4]) });
    });
    return map;
  }

  function buildNeedStepCache() {
    needStepCache = new Map();
    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) normalMap.set(lv, expTable.get(lv)?.normal || 0);
    needStepCache.set("normal", normalMap);
    
    const cumNormal = [0];
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) { sum += normalMap.get(lv) || 0; cumNormal[lv] = sum; }

    ["600", "semi", "legend"].forEach(typeKey => {
      const mul = TYPE_MUL[typeKey];
      const map = new Map();
      let prevScaled = 0;
      for (let lv = 2; lv <= 65; lv++) {
        const scaledCum = Math.round(cumNormal[lv] * mul);
        map.set(lv, scaledCum - prevScaled);
        prevScaled = scaledCum;
      }
      needStepCache.set(typeKey, map);
    });
  }

  function getNeedStep(targetLv, typeKey) {
    return needStepCache?.get(typeKey)?.get(targetLv) || 0;
  }

  // 負の数・eのガード
  function enforceInputGuard(input, maxDigits, min, max) {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === '-' || e.key === 'e') e.preventDefault();
    });
    input.addEventListener('input', () => {
      let val = input.value;
      if (val === "") return;
      let n = parseInt(val, 10);
      if (isNaN(n) || n < min) input.value = min;
      else if (n > max) input.value = max;
      if (input.value.length > maxDigits) input.value = input.value.slice(0, maxDigits);
    });
  }

  function getCandyExp(level, natureKey, boostMul) {
    let base = level < 25 ? 35 : (level < 30 ? 30 : 25);
    let natureMul = natureKey === "up" ? 1.18 : (natureKey === "down" ? 0.82 : 1.0);
    return Math.round(base * natureMul) * boostMul;
  }

  function simulateCandiesAndShards(opts) {
    let { lvNow, lvTarget, typeKey, natureKey, initialProgress, freeExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
    let currentExp = initialProgress + freeExp;
    let boostRemain = Math.max(0, boostCount);
    const boostExpMul = 2;
    const boostShardMul = boostKind === "mini" ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const needStep = getNeedStep(targetLv, typeKey);
      while (currentExp < needStep) {
        const useBoost = boostKind !== "none" && boostRemain > 0;
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
    const nowRaw = el("lvNow")?.value.trim();
    const targetRaw = el("lvTarget")?.value.trim();
    const natureSel = getRadio("lvNature");
    const typeSel = getRadio("lvType");

    if (!nowRaw || !targetRaw || !natureSel || !typeSel) {
      el("lvResult").style.display = "none";
      return;
    }

    const lvNow = parseInt(nowRaw);
    const lvTarget = parseInt(targetRaw);

    if (lvTarget <= lvNow) {
      el("lvResult").innerHTML = `<div class="lvResTitle">計算結果</div><div style="color:red; font-weight:bold; font-size:12px;">目標レベルは現在より大きくしてください</div>`;
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

    let initialProgress = Math.max(0, getNeedStep(lvNow + 1, typeSel) - progressExp);
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, typeSel);

    let freeExp = sleepDays * (100 + 14 * sleepBonus);
    for (let i = 0; i < incense; i++) freeExp *= 2;
    freeExp = Math.min(freeExp, totalSteps);

    const totalExpNeeded = Math.max(0, totalSteps - initialProgress - freeExp);
    const simNormal = simulateCandiesAndShards({ lvNow, lvTarget, typeKey: typeSel, natureKey: natureSel, initialProgress, freeExp, boostKind: "none", boostCount: 0 });

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    if (boostKind !== "none") {
      const simBoost = simulateCandiesAndShards({ lvNow, lvTarget, typeKey: typeSel, natureKey: natureSel, initialProgress, freeExp, boostKind, boostCount: boostCountEff });
      html += `<div class="lvResSubTitle">${boostKind === "mini" ? "ミニアメブースト時" : "アメブースト時"}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }

    // ⑥ ×ボタンの設置と描画
    el("lvResult").innerHTML = `<div id="lvResultClear" class="lvResultClose">×</div>` + html;
    el("lvResult").style.display = "block";

    // ×ボタンに全削除機能を紐付け
    el("lvResultClear").onclick = clearAll;
  }

  function clearAll() {
    // 全入力欄をリセット
    ["lvNow", "lvTarget", "lvProgressExp", "lvCandyOwned", "lvBoostCount", "lvSleepDays", "lvSleepBonus", "lvGrowthIncense"].forEach(id => {
      const x = el(id); if (x) x.value = "";
    });
    // 全ラジオを初期値へ
    document.querySelectorAll('#tab3 input[type="radio"]').forEach(r => {
      r.checked = (r.value === "none" || r.value === "normal");
    });
    boostCountTouched = false;
    el("lvResult").style.display = "none";
  }

  function bindOnce() {
    const tab3 = document.getElementById("tab3");
    
    enforceInputGuard(el("lvNow"), 2, 1, 64);
    enforceInputGuard(el("lvTarget"), 2, 2, 65);
    enforceInputGuard(el("lvProgressExp"), 4, 0, 9999);
    enforceInputGuard(el("lvCandyOwned"), 4, 0, 9999);
    enforceInputGuard(el("lvBoostCount"), 4, 0, 9999);
    enforceInputGuard(el("lvSleepDays"), 3, 0, 999);
    enforceInputGuard(el("lvSleepBonus"), 1, 0, 5);
    enforceInputGuard(el("lvGrowthIncense"), 3, 0, 999);

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

  window.LevelTab = { init() { if(!window.__LV_BOUND__){ window.__LV_BOUND__=true; bindOnce(); } onCalc(); } };
})();
