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

    // normal列はそのまま
    const normalMap = new Map();
    for (let lv = 2; lv <= 65; lv++) {
      const row = expTable.get(lv);
      normalMap.set(lv, row ? toNum(row.normal) : 0);
    }
    needStepCache.set("normal", normalMap);

    // 累計（normal）
    const cumNormal = [0];
    let sum = 0;
    for (let lv = 2; lv <= 65; lv++) {
      sum += normalMap.get(lv) || 0;
      cumNormal[lv] = sum;
    }

    // 600 / semi / legend：累計→丸め→差分
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
   * DOM helpers
   * ========================= */
  const el = id => document.getElementById(id);
  const getRadio = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  // 入力値を安全に「数字のみ・桁数制限・範囲制限」
  function enforceDigitsAndRange(input, maxDigits, min, max) {
    if (!input) return;
    const raw = (input.value ?? "").toString();

    // 空欄は許容（none状態）
    if (raw.trim() === "") return;

    // 数字以外を削除
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

    // 0は許容しない（指定が 1〜 のため）
    v = Math.max(min, Math.min(max, v));
    input.value = String(v);
  }

  // ブースト個数：ユーザーが手入力したかどうか
  let boostCountTouched = false;

  // 同じラジオをもう一度押したら解除できるようにする（ブースト用）
  function enableToggleRadio(name) {
    const radios = Array.from(document.querySelectorAll(`input[name="${name}"]`));
    if (!radios.length) return;

    radios.forEach(r => { r.dataset.wasChecked = r.checked ? "1" : "0"; });

    radios.forEach(r => {
      r.addEventListener("click", (e) => {
        // すでに選ばれているものを押したら解除
        if (r.checked && r.dataset.wasChecked === "1") {
          r.checked = false;
          r.dataset.wasChecked = "0";
          radios.forEach(x => { if (x !== r) x.dataset.wasChecked = "0"; });
          r.dispatchEvent(new Event("change", { bubbles: true }));
          e.preventDefault();
          return;
        }
        // 選び直し
        radios.forEach(x => x.dataset.wasChecked = "0");
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

    // (base * nature) を四捨五入 → ブースト倍率
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
  function showResult(innerHtml) {
    const box = el("lvResult");
    if (!box) return;

    // 結果欄右上に ×（タブ①の removeBtn デザイン流用）
    box.innerHTML = `
      <button id="lvResultClear" class="removeBtn lvResultClose" title="クリア">×</button>
      ${innerHtml}
    `;
    box.style.display = "block";
  }

  function hideResult() {
    const box = el("lvResult");
    if (!box) return;
    box.innerHTML = "";
    box.style.display = "none";
  }

  /* =========================
   * Main calc
   * ========================= */
  async function onCalc() {
    // 入力制限を都度適用（空欄はOK）
    enforceDigitsAndRange(el("lvNow"), 2, 1, 64);
    enforceDigitsAndRange(el("lvTarget"), 2, 2, 65);
    enforceDigitsAndRange(el("lvProgressExp"), 4, 1, 9999);
    enforceDigitsAndRange(el("lvCandyOwned"), 4, 1, 9999);
    enforceDigitsAndRange(el("lvBoostCount"), 4, 1, 9999);
    enforceDigitsAndRange(el("lvSleepDays"), 3, 1, 999);
    enforceDigitsAndRange(el("lvSleepBonus"), 1, 1, 5);
    enforceDigitsAndRange(el("lvGrowthIncense"), 3, 1, 999);

    const nowRaw = (el("lvNow")?.value ?? "").trim();
    const targetRaw = (el("lvTarget")?.value ?? "").trim();

    const natureSel = getRadio("lvNature");
    const typeSel = getRadio("lvType");

    // 必須（*）：今のレベル / 目標のレベル / 性格 / 経験値タイプ
    // すべて揃うまで計算結果は一切出さない（但し書きも出さない）
    if (!nowRaw || !targetRaw || !natureSel || !typeSel) {
      hideResult();
      return;
    }



    const lvNow = clampInt(nowRaw, 1, 64);
    const lvTarget = clampInt(targetRaw, 2, 65);

    if (lvTarget <= lvNow) {
      showResult(
        `<div class="lvResTitle">計算結果</div>
         <div class="lvlWarn">「目標のレベル」は「今のレベル」より大きい値にしてください</div>`
      );
      return;
    }

    await loadTablesOnce();

    const natureKey = natureSel;
    const typeKey = typeSel;

    const progressExp = toNum(el("lvProgressExp")?.value || 0); // 空欄は0扱い
    const candyOwned = toNum(el("lvCandyOwned")?.value || 0);   // 空欄は0扱い

    const boostKind = getRadio("lvBoostKind") || "none"; // 未選択=none

    // ★③：ブーストが選択された瞬間は「9999個扱い」で計算
    // ユーザーが個数を編集したら、その値で計算
    let boostCountEff = 0;
    if (boostKind !== "none") {
      if (!boostCountTouched) {
        boostCountEff = 9999;
      } else {
        // touched後は入力値を採用（空欄なら0＝ブーストなし個数）
        boostCountEff = toNum(el("lvBoostCount")?.value || 0);
        boostCountEff = clampInt(boostCountEff, 0, 9999);
      }
    }

    // オプション
    const sleepDays = toNum(el("lvSleepDays")?.value || 0);
    const sleepBonus = toNum(el("lvSleepBonus")?.value || 0);
    const incense = toNum(el("lvGrowthIncense")?.value || 0);

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
      const perDay = 100 + 14 * sleepBonus; // 100 + 14*体
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

    // ブースト（選択されている場合は常に表示）
    if (boostKind !== "none") {
      const simBoost = simulateCandiesAndShards({
        lvNow, lvTarget, typeKey, natureKey,
        initialProgress,
        freeExp,
        boostKind: boostKind === "mini" ? "mini" : "full",
        boostCount: boostCountEff
      });

      const subtitle = (boostKind === "mini")
        ? `ミニアメブースト時 (x2 / かけらx4)`
        : `アメブースト時 (x2 / かけらx5)`;

      // 9999仮定で計算していることが伝わるよう、個数も表示に出す（邪魔なら削除OK）
      const countLabel = (!boostCountTouched) ? `（個数：9999仮定）` : ``;

    if (boostKind !== "none") {
      const subtitle = (boostKind === "mini") ? `ミニアメブースト時` : `アメブースト時`;
      html += `<div class="lvResSubTitle">${subtitle}</div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なアメの数🍬</div><div class="lvResVal">${Math.max(0, simBoost.candiesTotal - candyOwned).toLocaleString()} 個</div></div>`;
      html += `<div class="lvResRow"><div class="lvResKey">必要なゆめのかけら量✨</div><div class="lvResVal">${simBoost.shardsTotal.toLocaleString()}</div></div>`;
    }

    showResult(html);
  }

  /* =========================
   * Clear (×ボタンで呼ぶ)
   * ========================= */
  function clearAll() {
    // 入力欄はすべて空に
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
      if (x) x.value = "";
    });

    // ラジオは全解除（none状態）
    ["lvNature", "lvType", "lvBoostKind"].forEach(name => {
      document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
        r.checked = false;
        r.dataset.wasChecked = "0";
      });
    });

    boostCountTouched = false;

    // 結果欄も初期表示に
    onCalc();
  }

  /* =========================
   * Bind events
   * ========================= */
  function bindOnce() {
    // すべての入力項目とラジオボタンにイベントを貼る
    const inputs = document.querySelectorAll('#tab3 input');
    inputs.forEach(input => {
      input.addEventListener('input', onCalc);
      input.addEventListener('change', onCalc);
    });
  
    // クイックボタンのクリック処理（機能復活）
    const tab3 = document.getElementById("tab3");
    if (tab3) {
      tab3.addEventListener("click", (e) => {
        const btn = e.target.closest(".lvlQuickBtn");
        if (!btn) return;
  
        if (btn.dataset.now) {
          const targetInput = document.getElementById("lvNow");
          targetInput.value = btn.dataset.now;
        }
        if (btn.dataset.target) {
          const targetInput = document.getElementById("lvTarget");
          targetInput.value = btn.dataset.target;
        }
        
        // ボタンを押した直後に計算を実行
        onCalc();
      });
    }
    
    // 初回実行
    onCalc();
  }

    // 結果欄×ボタン（innerHTMLで作り直されるので委譲）
    el("lvResult")?.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.id === "lvResultClear") clearAll();
    });

    // ブースト個数：ユーザーが編集したら以降はその値を使う
    el("lvBoostCount")?.addEventListener("input", () => {
      boostCountTouched = true;
      onCalc();
    });

    // 入力するたびに自動計算（ブースト個数は上で専用処理済）
    const tab = document.getElementById("tab3");
    if (tab) {
      tab.addEventListener("input", (e) => {
        const t = e.target;
        if (!t) return;

        // boostCountは専用処理済なので除外（2重呼び出し防止）
        if (t.id === "lvBoostCount") return;

        if (t.matches("#lvNow,#lvTarget,#lvProgressExp,#lvCandyOwned,#lvSleepDays,#lvSleepBonus,#lvGrowthIncense")) {
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

    // レベル入力欄のクイック（今のレベル / 目標レベル）
    const tab3 = document.getElementById("tab3");
    if (tab3) {
      tab3.addEventListener("click", (e) => {
        // ボタンのクリックを確実に拾う
        const btn = e.target.closest(".lvlQuickBtn");
        if (!btn) return;
    
        if (btn.dataset.now) {
          const input = document.getElementById("lvNow");
          if (input) input.value = btn.dataset.now;
        }
        if (btn.dataset.target) {
          const input = document.getElementById("lvTarget");
          if (input) input.value = btn.dataset.target;
        }
        // 値が変わったら再計算をトリガー
        onCalc();
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




