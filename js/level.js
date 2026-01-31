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

  // ブースト個数：ユーザーが手入力したか
  let boostCountTouched = false;

  async function loadTablesOnce() {
    if (expTable && shardTable) return;

    const [expTxt, shardTxt] = await Promise.all([
      fetch("./data/exp_table.txt", { cache: "no-store" }).then((r) => r.text()),
      fetch("./data/shard_table.txt", { cache: "no-store" }).then((r) => r.text()),
    ]);

    expTable = parseExpTable(expTxt);
    shardTable = parseTwoColTable(shardTxt);

    // ★必要EXPキャッシュ生成（累計→丸め→差分）
    buildNeedStepCache();
  }

  function parseTwoColTable(txt) {
    const map = new Map();
    txt.split(/\r?\n/).forEach((line) => {
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
    txt.split(/\r?\n/).forEach((line) => {
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
  const TYPE_MUL = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };

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
    ["600", "semi", "legend"].forEach((typeKey) => {
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

  /* =========================
   * DOM helpers
   * ========================= */
  const el = (id) => document.getElementById(id);
  const getRadio = (name) =>
    document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    const raw = (input.value ?? "").toString();

    // 空欄は許可（none状態）
    if (raw.trim() === "") return;

    let digits = raw.replace(/[^\d]/g, "");
    if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);

    if (digits === "") {
      input.value = "";
      return;
    }

    let v = parseInt(digits, 10);
    if (!Number.isFinite(v)) {
      input.value = "";
      return;
    }

    v = Math.max(min, Math.min(max, v));
    if (input.value !== String(v)) input.value = String(v);
  }

  // 「おこう」<=「睡眠日数」を強制（②：睡眠を超えたら最大値へ）
  function clampIncenseBySleep() {
    const sleepEl = el("lvSleepDays");
    const incEl = el("lvGrowthIncense");
    if (!sleepEl || !incEl) return;

    const sleepRaw = (sleepEl.value ?? "").trim();
    const incRaw = (incEl.value ?? "").trim();

    // 睡眠が未入力なら：おこうは通常上限
    if (!sleepRaw) {
      incEl.max = "999";
      return;
    }

    const sleep = Math.max(
      1,
      Math.min(999, parseInt(sleepRaw.replace(/[^\d]/g, ""), 10) || 1)
    );
    const maxInc = sleep;

    incEl.max = String(maxInc);

    if (!incRaw) return;

    let inc = parseInt(incRaw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(inc)) return;

    inc = Math.max(1, Math.min(999, inc));
    if (inc > maxInc) incEl.value = String(maxInc);
  }

  /* =========================
   * EXP per candy
   * ========================= */
  function getCandyExp(level, natureKey, boostMul) {
    // レベル帯の基礎値
    let base = 25;
    if (level < 25) base = 35;
    else if (level < 30) base = 30;

    // 性格補正
    let natureMul = 1.0;
    if (natureKey === "up") natureMul = 1.18;
    if (natureKey === "down") natureMul = 0.82;

    // 1個あたりは四捨五入 → ブースト倍率
    const gain = Math.round(base * natureMul);
    return gain * boostMul;
  }

  /* =========================
   * Simulator（ブースト復活：EXP×2 / かけら×4 or ×5）
   * ========================= */
  function simulateCandiesAndShards(opts) {
    const {
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      initialProgress, // すでに稼いだEXP（次Lvに対して）
      freeExp, // 睡眠など（アメ無し）
      boostKind, // "none" | "full" | "mini"
      boostCount,
    } = opts;

    let candies = 0;
    let shards = 0;
    let lv = lvNow;

    // 最初に「進捗」＋「freeExp」を載せる
    let currentExp = (initialProgress || 0) + (freeExp || 0);

    let boostRemain = Math.max(0, boostCount || 0);

    const boostExpMul = 2;
    const boostShardMul =
      boostKind === "mini" ? 4 : boostKind === "full" ? 5 : 1;

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const needStep = getNeedStep(targetLv, typeKey);

      // このレベルに到達するまでアメ投入
      while (currentExp < needStep) {
        const useBoost = boostKind !== "none" && boostRemain > 0;
        const bMul = useBoost ? boostExpMul : 1;
        const sMul = useBoost ? boostShardMul : 1;

        const gain = getCandyExp(lv, natureKey, bMul);
        const shardCost = (shardTable.get(targetLv) || 0) * sMul;

        candies++;
        shards += shardCost;
        currentExp += gain;

        if (useBoost) boostRemain--;
      }

      // レベルアップ：余剰EXPを持ち越し
      currentExp -= needStep;
      lv++;
    }

    return { candiesTotal: candies, shardsTotal: shards };
  }

  /* =========================
   * Main calc
   * ========================= */
  async function onCalc() {
    // 入力制限（空欄は許可）
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvCandyOwned"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvBoostCount"), 4, 0, 9999);
    enforceDigitsAndRange(el("lvSleepDays"), 3, 0, 999);
    enforceDigitsAndRange(el("lvSleepBonus"), 1, 0, 5);
    enforceDigitsAndRange(el("lvGrowthIncense"), 3, 0, 999);

    // おこう<=睡眠日数
    clampIncenseBySleep();

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
      el("lvResult").innerHTML =
        `<div id="lvResultClear" class="lvResultClose">×</div>` +
        `<div class="lvResTitle">計算結果</div>` +
        `<div style="color:red; font-size:12px; font-weight:bold;">目標のレベルは今のレベルより大きい値にしてください</div>`;
      el("lvResult").style.display = "block";
      el("lvResultClear").onclick = LevelTab.clearAll;
      return;
    }

    await loadTablesOnce();

    // ---- 次のレベルまでの経験値（空欄＝開始状態）----
    // UI上：入力された値だけ「必要経験値」から差し引く
    // 内部：入力値は「次Lvまでの残り」として扱い、LvNow→LvNow+1 の必要量から差し引く
    const progressRaw = (el("lvProgressExp")?.value ?? "").trim();
    const needForNextLevel = getNeedStep(lvNow + 1, typeSel);

    let remainToNext;
    if (progressRaw === "") {
      remainToNext = needForNextLevel; // 空欄＝開始状態
    } else {
      const v = toNum(progressRaw);
      remainToNext = Math.min(Math.max(v, 0), needForNextLevel);
    }

    // シミュレーション用：すでに稼いだ量（= need - 残り）
    const initialProgress = Math.max(0, needForNextLevel - remainToNext);

    // UI表示用：入力された値だけ「必要経験値」から差し引く（空欄は0）
    const progressForUi = progressRaw === "" ? 0 : remainToNext;

    // ---- 総必要経験値（タイプ倍率適用済み step を合算）----
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) totalSteps += getNeedStep(i, typeSel);

    // ---- 睡眠/ボーナス/おこう：freeExp ----
    const sleepDays = toNum(el("lvSleepDays")?.value) || 0;
    const sleepBonus = toNum(el("lvSleepBonus")?.value) || 0;
    const incense = toNum(el("lvGrowthIncense")?.value) || 0;

    // おこうは睡眠日数以下（強制済み）
    const usedIncense = Math.min(sleepDays, incense);

    // 「睡眠EXPボーナスは、おこうを使ってない日も +14（常に 100+14*n）」
    const perDayBase = 100 + 14 * sleepBonus;

    // おこう日は「最後を*2」＝その日分をもう1回加算 → 合計は (sleepDays + usedIncense) 日ぶん
    const freeExpSim = perDayBase * (sleepDays + usedIncense);

    // freeExp は総必要expを超えて意味がないので丸め
    const freeExpClamped = Math.min(freeExpSim, totalSteps);

    // ---- UI表示用の freeExp（progressForUi を引いた残りに対して適用）----
    const remainAfterUi = Math.max(0, totalSteps - progressForUi);
    const freeExpUi = Math.min(freeExpClamped, remainAfterUi);

    // UI表示の必要経験値
    const totalExpNeeded = Math.max(0, totalSteps - progressForUi - freeExpUi);

    // ---- 所持アメ（表示上は必要アメから差し引き）----
    const candyOwned = toNum(el("lvCandyOwned")?.value); // HTML側で非表示/欠損でも0扱い

    // ---- ブースト ----
    const boostKind = getRadio("lvBoostKind") || "none";

    // ③「選択された段階では 9999 個入力された前提」
    // 　ユーザーがブースト個数に手入力したら、その値を使う
    const boostCountEff = boostCountTouched ? (toNum(el("lvBoostCount")?.value) || 0) : 9999;

    // ---- シミュレーション（通常）----
    const simNormal = simulateCandiesAndShards({
      lvNow,
      lvTarget,
      typeKey: typeSel,
      natureKey: natureSel,
      initialProgress,
      freeExp: freeExpClamped,
      boostKind: "none",
      boostCount: 0,
    });

    let html =
      `<div id="lvResultClear" class="lvResultClose">×</div>` +
      `<div class="lvResTitle">計算結果</div>`;

    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `
      <div class="lvResRow">
        <div class="lvResKey">
          必要なゆめのかけら量✨
          // 小さくしつつ、少しだけ色を薄くする
          <div style="font-size:0.75em; font-weight:inherit; margin-top:2px; opacity: 0.8;">
            └ 数十程度の誤差が出る場合があります
          </div>
        </div>
        <div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div>
      </div>
    `;

    // ---- シミュレーション（ブースト）----
    if (boostKind !== "none") {
      const simBoost = simulateCandiesAndShards({
        lvNow,
        lvTarget,
        typeKey: typeSel,
        natureKey: natureSel,
        initialProgress,
        freeExp: freeExpClamped,
        boostKind,
        boostCount: boostCountEff,
      });

      const subtitle = boostKind === "mini" ? "ミニアメブースト時" : "アメブースト時";
      html += `<div class="lvResSubTitle">${subtitle}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `
        <div class="lvResRow">
          <div class="lvResKey">
            必要なゆめのかけら量✨
            // 小さくしつつ、少しだけ色を薄くする
            <div style="font-size:0.75em; font-weight:inherit; margin-top:2px; opacity: 0.8;">
              └ 数十程度の誤差が出る場合があります
            </div>
          </div>
          <div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div>
        </div>
      `;
    }

    el("lvResult").innerHTML = html;
    el("lvResult").style.display = "block";
    el("lvResultClear").onclick = LevelTab.clearAll;
  }

  /* =========================
   * Bind
   * ========================= */
  function bindOnce() {
    const tab3 = document.getElementById("tab3");
    if (!tab3) return;

    tab3.addEventListener("input", (e) => {
      // ブースト個数を触ったら、以後その値を使う
      if (e.target.id === "lvBoostCount") boostCountTouched = true;

      // 睡眠 or おこうが変わったら、おこう上限を即反映
      if (e.target.id === "lvSleepDays" || e.target.id === "lvGrowthIncense") {
        clampIncenseBySleep();
      }

      onCalc();
    });

    tab3.addEventListener("change", () => {
      onCalc();
    });

    // レベルのクイック（今のレベル / 目標レベル）
    tab3.addEventListener("click", (e) => {
      const btn = e.target.closest(".lvlQuickBtn");
      if (!btn) return;

      if (btn.dataset.now) el("lvNow").value = btn.dataset.now;
      if (btn.dataset.target) el("lvTarget").value = btn.dataset.target;
      onCalc();
    });

    // ブーストのラジオ：同じものをもう一度押したら解除できるようにする
    const radios = tab3.querySelectorAll('input[name="lvBoostKind"]');
    radios.forEach((r) => {
      let wasChecked = false;
      r.addEventListener("mousedown", () => {
        wasChecked = r.checked;
      });
      r.addEventListener("click", () => {
        if (wasChecked) {
          r.checked = false;
        }
        onCalc();
      });
    });
  }

  /* =========================
   * Public
   * ========================= */
  window.LevelTab = {
    init() {
      if (!window.__LV_BOUND__) {
        window.__LV_BOUND__ = true;
        bindOnce();
      }
      onCalc();
    },
    clearAll() {
      [
        "lvNow",
        "lvTarget",
        "lvProgressExp",
        "lvCandyOwned",
        "lvBoostCount",
        "lvSleepDays",
        "lvSleepBonus",
        "lvGrowthIncense",
      ].forEach((id) => {
        const x = el(id);
        if (x) x.value = "";
      });

      // ラジオも none に戻す
      ["lvNature", "lvType", "lvBoostKind"].forEach((name) => {
        document
          .querySelectorAll(`input[name="${name}"]`)
          .forEach((r) => (r.checked = false));
      });

      // ブースト個数の「未入力＝9999仮定」を復帰
      boostCountTouched = false;

      const box = el("lvResult");
      if (box) box.style.display = "none";
    },
  };
})();




