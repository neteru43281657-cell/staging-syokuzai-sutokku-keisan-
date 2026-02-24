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

  const TYPE_MUL = { normal: 1.0, "600": 1.5, semi: 1.8, legend: 2.2 };

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

  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    let v = input.value.replace(/[^\d]/g, "");
    if (v.length > maxDigits) v = v.slice(0, maxDigits);
    if (v !== "") {
      let num = Math.max(min, Math.min(max, parseInt(v, 10)));
      input.value = String(num);
    }
  }

  function clampSubOptions() {
    const sleep = toNum(el("lvSleepDays").value);
    const incEl = el("lvGrowthIncense");
    const gsdEl = el("lvGSD");
    if (toNum(incEl.value) > sleep) incEl.value = sleep || "";
    if (toNum(gsdEl.value) > sleep) gsdEl.value = sleep || "";
  }

  function getCandyExp(level, natureKey, boostMul) {
    let base = level < 25 ? 35 : (level < 30 ? 30 : 25);
    let natureMul = natureKey === "up" ? 1.18 : (natureKey === "down" ? 0.82 : 1.0);
    return Math.round(base * natureMul) * boostMul;
  }

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

  function simulate(opts) {
    const { lvNow, lvTarget, typeKey, natureKey, initialProgress, freeExp, boostKind, boostCount } = opts;
    let candies = 0, shards = 0, lv = lvNow;
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

  async function onCalc() {
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvOwnedCandy"), 4, 0, 9999);
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

    // 1. 入力不足時の初期表示
    if (!lvNow || !lvTarget || !nature || !type) {
      container.innerHTML = `
        <div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">0 pt</div></div>
        <div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">0 個</div></div>
        <div class="lvResRow" style="align-items: center;">
          <div class="lvResKey">
            <span>必要なゆめのかけら量✨</span>
            <span class="info-btn-tiny" onclick="showInfo('数十程度の誤差が出る場合があります')">ⓘ</span>
          </div>
          <div class="lvResVal" style="padding-top: 2px;">0</div>
        </div>`;
      return;
    }

    if (lvTarget <= lvNow) {
      container.innerHTML = `<div style="color:red; font-size:12px; font-weight:bold;">目標レベルを現在のレベルより大きくしてください</div>`;
      return;
    }

    await loadTablesOnce();

    const needForNext = getNeedStep(lvNow + 1, type);
    const progressInput = toNum(el("lvProgressExp").value);
    const initialProgress = Math.max(0, needForNext - Math.min(progressInput || needForNext, needForNext));

    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, type);
    const freeExp = calculateFreeExp();
    const displayExpNeeded = Math.max(0, totalSteps - (needForNext - Math.min(progressInput || needForNext, needForNext)) - freeExp);

    const boostKind = getRadio("lvBoostKind") || "none";
    const bCountStr = el("lvBoostCount").value;
    const isBoostCountEmpty = (bCountStr === "");
    const bCount = isBoostCountEmpty ? 9999 : toNum(bCountStr);

    const ownedCandy = toNum(el("lvOwnedCandy").value);

    // ★修正：再描画する前に、現在の「備考」が開いているかチェックして記憶しておく
    const currentDetails = container.querySelector("details");
    const isDetailsOpen = currentDetails && currentDetails.open;

    const resNormal = simulate({ lvNow, lvTarget, typeKey: type, natureKey: nature, initialProgress, freeExp, boostKind: "none", boostCount: 0 });
    const missingNormal = Math.max(0, resNormal.candies - ownedCandy);

    // ★ヘルパー: 所持数・不足分の行を作る関数
    const makeSubRows = (totalNeed) => {
      const missing = Math.max(0, totalNeed - ownedCandy);
      return `
        <div style="font-size:10px; color:#5d6d7e; text-align:right; margin-top:-4px; margin-bottom:4px;">
           所持数：${ownedCandy.toLocaleString()}個 / 不足分：<span style="color:${missing > 0 ? '#e74c3c' : '#5d6d7e'}">${missing.toLocaleString()}個</span>
        </div>
      `;
    };

    // 2. 通常計算結果の表示
    let html = `
      <div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${displayExpNeeded.toLocaleString()} pt</div></div>
      
      <div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${resNormal.candies.toLocaleString()} 個</div></div>
      ${makeSubRows(resNormal.candies)}

      <div class="lvResRow" style="align-items: center;">
        <div class="lvResKey">
          <span>必要なゆめのかけら量✨</span>
          <span class="info-btn-tiny" onclick="showInfo('数十程度の誤差が出る場合があります')">ⓘ</span>
        </div>
        <div class="lvResVal" style="padding-top: 2px;">${resNormal.shards.toLocaleString()}</div>
      </div>`;

    if (boostKind !== "none") {
      const resBoost = simulate({ lvNow, lvTarget, typeKey: type, natureKey: nature, initialProgress, freeExp, boostKind, boostCount: bCount });
      const diffShard = resBoost.shards - resNormal.shards;

      let boostHeader = "";
      const boostRateInfo = boostKind === "mini" ? "(EXP2倍/かけら4倍)" : "(EXP2倍/かけら5倍)";
      
      // ★変更点：半角スペースを <br> に変えて、確実に2段になるようにしました
      if (isBoostCountEmpty) {
        boostHeader = `${boostKind === "mini" ? "ミニアメブースト" : "アメブースト"}最大数適用時<br>${boostRateInfo}`;
      } else {
        boostHeader = `${boostKind === "mini" ? "ミニアメブースト" : "アメブースト"} ${bCount}個適用時<br>${boostRateInfo}`;
      }

      // 3. ブースト計算結果の表示
      html += `<div class="lvResSubTitle" style="font-size: 12.5px;">${boostHeader}</div>
               <div class="lvResRow">
                 <div class="lvResKey">必要なアメの数🍬</div>
                 <div class="lvResVal">${resBoost.candies.toLocaleString()} 個</div>
               </div>
               ${makeSubRows(resBoost.candies)}
               
               <div class="lvResRow" style="align-items: center;">
                 <div class="lvResKey">
                   <span>必要なゆめのかけら量✨</span>
                   <span class="info-btn-tiny" onclick="showInfo('数十程度の誤差が出る場合があります')">ⓘ</span>
                 </div>
                 <div class="lvResVal" style="padding-top: 2px;">
                   ${resBoost.shards.toLocaleString()} <span style="color:#e74c3c; font-size:0.9em;">(+${diffShard.toLocaleString()})</span>
                 </div>
               </div>`;
    }

  /* ========== 備考欄（機能停止中） ==========
  // 復活させる場合は、ここのコメントアウトを外す

  // ★追加: 備考欄（マイルストーン計算）
  const milestones = [25, 30, 50, 55, 60, 65];
  
  // 現在のレベル(lvNow)ではなく「目標レベル(lvTarget)」より大きいものだけ抽出
  const validMilestones = milestones.filter(m => m > lvTarget);

  // ブーストが選択されている場合(boostKind !== "none")のみ表示
  if (validMilestones.length > 0 && boostKind !== "none") {
    let detailsHtml = "";
    validMilestones.forEach(ms => {
      const msRes = simulate({ 
        lvNow, lvTarget: ms, typeKey: type, natureKey: nature, initialProgress, freeExp, 
        boostKind, boostCount: bCount 
      });
      const msMissing = Math.max(0, msRes.candies - ownedCandy);

      detailsHtml += `
        <div style="display:flex; justify-content:space-between; align-items:baseline; border-bottom: 1px dashed #eee; padding: 6px 0;">
          <div style="font-weight:900; font-size:11px; color:var(--text); white-space:nowrap; margin-right:4px;">Lv.${ms}まで</div>
          <div style="font-size:10px; text-align:right; color:#5d6d7e; line-height:1.2;">
            必要数：${msRes.candies.toLocaleString()}　所持数：${ownedCandy.toLocaleString()}　<span style="font-weight:900; color:${msMissing > 0 ? '#e74c3c' : '#5d6d7e'};">不足数：${msMissing.toLocaleString()}</span>
          </div>
        </div>`;
    });

    html += `
      <div style="margin-top: 16px; padding-top: 8px;">
        <details style="cursor:pointer;">
          <summary style="font-size:12px; font-weight:900; color:var(--main); outline:none;">▼備考</summary>
          <div style="margin-top:8px; padding:0 8px; background:#f8f9fa; border-radius:8px;">
            ${detailsHtml}
          </div>
        </details>
      </div>
    `;
  }
  ========================================== */

    container.innerHTML = html;
  }

  window.LevelTab = {
    init() {
      if (!window.__LV_BOUND__) {
        window.__LV_BOUND__ = true;
        el("tab3").addEventListener("input", (e) => {
          if (e.target.id === "lvBoostCount") boostCountTouched = true;
          onCalc();
        });
        el("tab3").addEventListener("change", onCalc);
        
        el("tab3").addEventListener("click", (e) => {
          const btn = e.target.closest(".lvlQuickBtn");
          if (btn) {
            // ★GAイベント追加：目標レベルのクイックボタンが押されたら計測
            if (btn.dataset.target && typeof gtag === 'function') {
              gtag('event', 'click_quick_level', {
                'target_level': btn.dataset.target
              });
            }

            if (btn.dataset.now) el("lvNow").value = btn.dataset.now;
            if (btn.dataset.target) el("lvTarget").value = btn.dataset.target;
            onCalc();
          }
        });

        const clearBtn = el("lvResultClear");
        if (clearBtn) {
          clearBtn.onclick = () => {
            this.clearAll();
            onCalc();
          };
        }
      }
      onCalc();
    },
    clearAll() {
      ["lvNow", "lvTarget", "lvProgressExp", "lvOwnedCandy", "lvBoostCount", "lvSleepDays", "lvSleepBonus", "lvGrowthIncense", "lvGSD"].forEach(id => {
        const input = el(id);
        if (input) input.value = "";
      });
      document.querySelectorAll('input[name="lvNature"], input[name="lvType"], input[name="lvBoostKind"]').forEach(r => r.checked = false);
      boostCountTouched = false;
    }
  };
})();

