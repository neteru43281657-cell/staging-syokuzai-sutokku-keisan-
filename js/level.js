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
    const m = (needStepCache && (needStepCache.get(typeKey) || needStepCache.get("normal"))) || null;
    return m ? (m.get(targetLv) || 0) : 0;
  }

  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  /* =========================
   * Input helpers / toggles
   * ========================= */
  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  function setVal(inputEl, v) {
    if (!inputEl) return;
    inputEl.value = String(v);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // 同じラジオをもう一度押したら解除できるようにする（ブースト用）
  function enableToggleRadio(name) {
    const radios = Array.from(document.querySelectorAll(`input[name="${name}"]`));
    if (!radios.length) return;

    // 初期状態の記録
    radios.forEach(r => { r.dataset.wasChecked = r.checked ? "1" : "0"; });

    radios.forEach(r => {
      r.addEventListener("click", (e) => {
        // すでに選ばれているものを押したら解除
        if (r.checked && r.dataset.wasChecked === "1") {
          r.checked = false;
          r.dataset.wasChecked = "0";
          // 他の wasChecked も 0 に
          radios.forEach(x => { if (x !== r) x.dataset.wasChecked = "0"; });
          // change を発火して再計算
          r.dispatchEvent(new Event("change", { bubbles: true }));
          e.preventDefault();
          return;
        }

        // 選び直し：他は0、このラジオを1
        radios.forEach(x => x.dataset.wasChecked = "0");
        // click の時点で checked になっているので即反映
        r.dataset.wasChecked = "1";
      });
    });
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

    // 1個あたりは四捨五入
    const gain = Math.round(base * natureMul);
    return gain * boostMul;
  }

  /* =========================
   * Simulator
   * ========================= */
  function simulateCandiesAndShards(opts) {
    const {
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      initialProgress,
      freeExp,        // ★睡眠などで得るEXP（アメ無し）
      boostKind,      // "none" | "full" | "mini"
      boostCount
    } = opts;

    let candies = 0;
    let shards = 0;
    let lv = lvNow;

    // 最初に「進捗」＋「freeExp」を載せる
    let currentExp = (initialProgress || 0) + (freeExp || 0);

    let boostRemain = Math.max(0, boostCount || 0);
    const boostExpMul = 2;
    const boostShardMul = (boostKind === "mini") ? 4 : (boostKind === "full" ? 5 : 1);

    while (lv < lvTarget) {
      const targetLv = lv + 1;
      const needStep = getNeedStep(targetLv, typeKey);

      // このレベルに到達するまでアメ投入
      while (currentExp < needStep) {
        const useBoost = (boostKind !== "none" && boostRemain > 0);
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
   * Result rendering
   * ========================= */
  function showResult(html) {
    const box = el("lvResult");
    if (!box) return;
    box.innerHTML = html;
    box.style.display = "block";
  }

  /* =========================
   * Main calc
   * ========================= */
  async function onCalc() {
    const nowRaw = (el("lvNow")?.value ?? "").trim();
    const targetRaw = (el("lvTarget")?.value ?? "").trim();

    // 未入力でも「計算結果」だけは表示（案内文は出さない）
    if (!nowRaw || !targetRaw) {
      showResult(`<div class="lvResTitle">計算結果</div>`);
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

    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);

    const boostKind = getRadio("lvBoostKind") || "none"; // 未選択=none
    const boostCount = clampInt(el("lvBoostCount")?.value || 0, 0, 9999);

    // オプション
    const sleepDays = clampInt(el("lvSleepDays")?.value || 0, 0, 999);
    const sleepBonus = clampInt(el("lvSleepBonus")?.value || 0, 0, 5);
    const incense = clampInt(el("lvGrowthIncense")?.value || 0, 0, 999);

    // 次レベル必要EXP
    const needForNextLevel = getNeedStep(lvNow + 1, typeKey);

    // 進捗（次レベルまでの残り）→ 既に稼いだ量に変換
    let initialProgress = 0;
    if (progressExp > 0 && progressExp < needForNextLevel) {
      initialProgress = needForNextLevel - progressExp;
    }

    // 総必要EXP（needStep合計）
    let totalSteps = 0;
    for (let i = lvNow + 1; i <= lvTarget; i++) {
      totalSteps += getNeedStep(i, typeKey);
    }

    // freeExp（睡眠など）を算出し、上限を totalSteps にする
    let freeExp = 0;
    if (sleepDays > 0) {
      const perDay = 100 + 14 * sleepBonus;
      freeExp = perDay * sleepDays;

      if (incense > 0) {
        // *2 を incense 個分（ただし totalSteps を超えたら打ち止め）
        let i = 0;
        while (i < incense && freeExp < totalSteps) {
          freeExp *= 2;
          if (freeExp >= totalSteps) { freeExp = totalSteps; break; }
          i++;
        }
      }
      if (freeExp > totalSteps) freeExp = totalSteps;
    }

    // 表示用：必要経験値（進捗 + freeExp 分を差し引き）
    const totalExpNeeded = Math.max(0, totalSteps - initialProgress - freeExp);

    // シミュレーション（通常）
    const simNormal = simulateCandiesAndShards({
      lvNow, lvTarget, typeKey, natureKey,
      initialProgress,
      freeExp,
      boostKind: "none",
      boostCount: 0
    });

    let html = `<div class="lvResTitle">計算結果</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要経験値</div><div class="lvResVal">${totalExpNeeded.toLocaleString()} pt</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simNormal.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simNormal.shardsTotal.toLocaleString()}</div></div>`;


    // 選択中ブーストのみ表示（種類選択 + 個数>0）
    if (boostKind !== "none" && boostCount > 0) {
      const simBoost = simulateCandiesAndShards({
        lvNow, lvTarget, typeKey, natureKey,
        initialProgress,
        freeExp,
        boostKind: boostKind === "mini" ? "mini" : "full",
        boostCount
      });

      const subtitle = (boostKind === "mini")
        ? `ミニブースト時 (x2 / かけらx4)`
        : `アメブースト時 (x2 / かけらx5)`;

    html += `<div class="lvResSubTitle">${subtitle}</div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
    html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;

    }

    showResult(html);
  }

  /* =========================
   * Clear
   * ========================= */
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
      const x = el(id);
      if (!x) return;
      if (id === "lvBoostCount") x.value = "0";
      else x.value = "";
    });

    // ブースト：両方解除
    document.querySelectorAll('input[name="lvBoostKind"]').forEach(r => {
      r.checked = false;
      r.dataset.wasChecked = "0";
    });

    onCalc();
  }

  /* =========================
   * Bind events
   * ========================= */
  function bindOnce() {
    // ブーストラジオを「押し直し解除」に
    enableToggleRadio("lvBoostKind");

    // クリア
    el("lvClear")?.addEventListener("click", clearAll);

    // クイック（レベル/ブースト）
    document.getElementById("tab3")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".lvlQuickBtn");
      if (!btn) return;

      if (btn.dataset.now) setVal(el("lvNow"), btn.dataset.now);
      if (btn.dataset.target) setVal(el("lvTarget"), btn.dataset.target);

      if (btn.dataset.boost) {
        setVal(el("lvBoostCount"), btn.dataset.boost);

        // ブーストが未選択ならアメブーストを選択
        const checked = document.querySelector('input[name="lvBoostKind"]:checked');
        if (!checked) {
          const rFull = document.querySelector('input[name="lvBoostKind"][value="full"]');
          if (rFull) {
            rFull.checked = true;
            document.querySelectorAll('input[name="lvBoostKind"]').forEach(x => x.dataset.wasChecked = "0");
            rFull.dataset.wasChecked = "1";
          }
        }
        onCalc();
      }
    });

    // 入力するたびに自動計算
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

    // 初期表示
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

