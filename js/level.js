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

  async function loadTablesOnce() {
    if (expTable && shardTable) return;
    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then(r => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then(r => r.text()),
    ]);
    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);
    buildNeedStepCache(); // ← 追加

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
   * 必要EXP（タイプ倍率）算出：累計→丸め→差分
   * ========================= */
  
  const TYPE_MUL = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };
  
  // Map<typeKey, Map<targetLv, needStep>>
  let needStepCache = null;
  
  function buildNeedStepCache() {
    if (!expTable) return;
  
    needStepCache = new Map();
  
    // ふつう（normal）はそのまま（exp_table の normal 列を使う）
    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) {
      const row = expTable.get(lv);
      normalMap.set(lv, row ? toNum(row.normal) : 0);
    }
    needStepCache.set("normal", normalMap);
  
    // 累計（ふつう）を作る
    const cumNormal = [0]; // index unused
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }
  
    // 600 / semi / legend を「累計→丸め→差分」で生成
    ["600", "semi", "legend"].forEach(typeKey => {
      const mul = TYPE_MUL[typeKey] || 1.0;
  
      const map = new Map();
      let prevScaled = 0;
  
      for (let lv = 2; lv <= 65; lv++) {
        const scaledCum = Math.round((cumNormal[lv] || 0) * mul);
        const step = scaledCum - prevScaled;
        map.set(lv, step);
        prevScaled = scaledCum;
      }
  
      needStepCache.set(typeKey, map);
    });
  }
  
  function getNeedStep(targetLv, typeKey) {
    if (!needStepCache) buildNeedStepCache();
    const m = needStepCache?.get(typeKey) || needStepCache?.get("normal");
    return m?.get(targetLv) || 0;
  }

  
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  /**
   * アメ1個あたりの基礎EXPを性格補正込みで算出
   * 数値は検証データに基づき、以下の固定値を使用します
   */
  function getCandyExp(level, natureKey, boostMul) {
    let base = 25;
    if (level < 25) base = 35;
    else if (level < 30) base = 30;

    let natureMul = 1.0;
    if (natureKey === "up") natureMul = 1.18;
    if (natureKey === "down") natureMul = 0.82;

    // 1個ずつの獲得EXPは四捨五入される
    let gain = Math.round(base * natureMul);
    return gain * boostMul;
  }

  function simulateCandiesAndShards(opts) {
    const {
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      initialProgress,
      freeExp,          // ★追加：睡眠等で差し引くEXP（アメ無しで得るEXP）
      boostKind,
      boostCount
    } = opts;

    let candies = 0;
    let shards = 0;
    let lv = lvNow;

    // ★最初に「進捗（次Lvまでの差し引き）」＋「freeExp」を載せる
    let currentExp = (initialProgress || 0) + (freeExp || 0);

    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = (boostKind === "none") ? 1 : 2;
    const boostShardMul = (boostKind === "mini") ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const row = expTable.get(targetLv);
      if (!row) break;

      const needStep = getNeedStep(targetLv, typeKey);

      // このレベル（targetLv）に到達するまでアメを投入
      while (currentExp < needStep) {
        const useBoost = (boostRemain > 0 && boostKind !== "none");
        const bMul = useBoost ? boostExpMul : 1;
        const sMul = useBoost ? boostShardMul : 1;

        const gain = getCandyExp(lv, natureKey, bMul);
        const shardCost = (shardTable.get(targetLv) || 0) * sMul;

        candies++;
        shards += shardCost;
        currentExp += gain;

        if (useBoost) boostRemain--;
      }

      // レベルアップ処理：余剰EXPを次に持ち越し
      currentExp -= needStep;
      lv++;
    }

    return { candiesTotal: candies, shardsTotal: shards };
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
    // ★結果は常に表示（入力不足なら案内だけ出す）
    const nowRaw = (el("lvNow")?.value ?? "").trim();
    const targetRaw = (el("lvTarget")?.value ?? "").trim();

    if (!nowRaw || !targetRaw) {
      showResult(`<div class="lvResTitle">計算結果</div><div class="lvlWarn">「今のレベル」「目標レベル」を入力すると自動で計算します</div>`);
      return;
    }

    const lvNow = clampInt(nowRaw, 1, 64);
    const lvTarget = clampInt(targetRaw, 2, 65);
    if (lvTarget <= lvNow) {
      showResult(`<div class="lvResTitle">計算結果</div><div class="lvlWarn">「目標のレベル」は「今のレベル」より大きい値にしてください</div>`);
      return;
    }

    await loadTablesOnce();

    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";

    // 進捗（次Lvまでの残り）
    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);

    // 所持アメ
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);

    // ★ブースト統合
    const boostKind = getRadio("lvBoostKind") || "none"; // none/full/mini
    const boostCount = clampInt(el("lvBoostCount")?.value || 0, 0, 9999);

    // ★オプション
    const sleepDays = clampInt(el("lvSleepDays")?.value || 0, 0, 999);
    const sleepBonus = clampInt(el("lvSleepBonus")?.value || 0, 0, 5);
    const incense = clampInt(el("lvGrowthIncense")?.value || 0, 0, 999);

    // 次Lv必要EXP
    const needForNextLevel = getNeedStep(lvNow + 1, typeKey);

    // 既に稼いだ進捗（= need - 残り）
    let initialProgress = 0;
    if (progressExp > 0 && progressExp < needForNextLevel) {
      initialProgress = needForNextLevel - progressExp;
    }

    // 総必要EXP（丸め済needStepの合計）
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) {
      totalSteps += getNeedStep(i, typeKey);
    }

    // ★freeExp（睡眠など）を算出：過剰にならないよう totalSteps で上限をかける
    let freeExp = 0;
    if (sleepDays > 0) {
      const perDay = 100 + 14 * sleepBonus; // 例：bonus=5 → 170
      freeExp = perDay * sleepDays;

      // せいちょうのおこう：最後を *2（個数ぶん）
      // ※巨大入力でも壊れないよう、合計必要EXPを上限にして倍々にする
      for (let i = 0; i < incense; i++) {
        freeExp = Math.min(totalSteps, freeExp * 2);
        if (freeExp >= totalSteps) break;
      }
      freeExp = Math.min(totalSteps, freeExp);
    }

    // 表示用：必要経験値（進捗 + freeExp を差し引く）
    let totalExpNeeded = Math.max(0, totalSteps - initialProgress - freeExp);

    // ==== シミュレーション ====
    const simNormal = simulateCandiesAndShards({
      lvNow, lvTarget, typeKey, natureKey,
      initialProgress,
      freeExp,
      boostKind: "none",
      boostCount: 0
    });

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;

    html += `<div class="lvResRow"><div class="lvResKey"><img class="lvIcon" src="images/アメ_透過.png" alt="">必要なアメの数</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey"><img class="lvIcon" src="images/ゆめのかけら_透過.png" alt="">必要なゆめのかけら量</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;

    // ★選択中のブーストだけ表示（個数>0 かつ なし以外）
    if (boostKind !== "none" && boostCount > 0) {
      const simBoost = simulateCandiesAndShards({
        lvNow, lvTarget, typeKey, natureKey,
        initialProgress,
        freeExp,
        boostKind: boostKind === "mini" ? "mini" : "full",
        boostCount
      });

      const subtitle =
        (boostKind === "mini")
          ? `ミニブースト時 (x2 / かけらx4)`
          : `アメブースト時 (x2 / かけらx5)`;

      html += `<div class="lvResSubTitle"><img class="lvIcon" src="images/アメブースト_透過.png" alt="">${subtitle}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey"><img class="lvIcon" src="images/アメ_透過.png" alt="">必要なアメの数</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey"><img class="lvIcon" src="images/ゆめのかけら_透過.png" alt="">必要なゆめのかけら量</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }

    showResult(html);
  }


  function clearAll() {
    [
      "lvNow",
      "lvTarget",
      "lvProgressExp",
      "lvCandyOwned",
      "lvBoostCount",
      "lvSleepDays",
      "lvSleepBonus",
      "lvGrowthIncense"
    ].forEach(id => {
      if (!el(id)) return;
      // 個数系は 0、それ以外は空に戻す（見た目を自然に）
      if (id === "lvBoostCount") el(id).value = "0";
      else el(id).value = "";
    });

    // ブースト：なしへ戻す
    const rNone = document.querySelector('input[name="lvBoostKind"][value="none"]');
    if (rNone) rNone.checked = true;

    // 結果は常時表示なので、案内を出す
    onCalc();
  }


  function bindOnce() {
    // 計算ボタンは廃止：入力/変更ごとに自動計算
    el("lvClear")?.addEventListener("click", clearAll);

    // クイックボタン（レベル/ブースト）
    document.getElementById("tab3")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lvlQuickBtn"); if (!btn) return;

      if (btn.dataset.now) setVal(el("lvNow"), btn.dataset.now);
      if (btn.dataset.target) setVal(el("lvTarget"), btn.dataset.target);

      if (btn.dataset.boost) {
        setVal(el("lvBoostCount"), btn.dataset.boost);

        // もし「なし」だったら、とりあえずアメブーストへ（使う意図が自然）
        const cur = getRadio("lvBoostKind") || "none";
        if (cur === "none") {
          const rFull = document.querySelector('input[name="lvBoostKind"][value="full"]');
          if (rFull) { rFull.checked = true; }
        }
        onCalc();
      }
    });

    // 入力で再計算（イベント委譲）
    const tab = document.getElementById("tab3");
    if (tab) {
      tab.addEventListener("input", (e) => {
        const t = e.target;
        if (!t) return;
        if (t.matches("#lvNow,#lvTarget,#lvProgressExp,#lvCandyOwned,#lvBoostCount,#lvSleepDays,#lvSleepBonus,#lvGrowthIncense")) {
          onCalc();
        }
      });

      tab.addEventListener("change", (e) => {
        const t = e.target;
        if (!t) return;
        if (t.name === "lvNature" || t.name === "lvType" || t.name === "lvBoostKind") {
          onCalc();
        }
      });
    }

    // 初期表示（結果を常に出す）
    onCalc();
  }


  window.LevelTab = {
    init() {
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    }
  };

})();


