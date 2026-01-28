"use strict";

function toNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // "1,032" → "1032"
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

(function () {
  // =========================
  // 設定（仕様確定版）
  // =========================
  const LV_MIN = 1;
  const LV_MAX = 65;

  const EXP_TYPE_MULT = {
    normal: 1.0,
    "600": 1.5,
    semi: 1.8,
    legend: 2.2,
  };

  // アメ1個あたりの基礎EXP（レベル帯 × 性格）
  // ※ここは「表の値」を使い、さらに性格の追加係数を掛ける
  function baseCandyExp(level, nature) {
    // レベル帯
    // Lv1〜25 / Lv25〜30 / Lv30以上
    // ※Lv25は「25〜30帯」に含める（ユーザー入力上 “25/30ボタン”があるので自然）
    let band;
    if (level < 25) band = "1_25";
    else if (level < 30) band = "25_30";
    else band = "30_plus";

    const table = {
      "1_25": { none: 35, up: 41, down: 29 },
      "25_30": { none: 30, up: 35, down: 25 },
      "30_plus": { none: 25, up: 30, down: 21 },
    };

    const base = table[band][nature] ?? table[band].none;

    // 追加補正（ユーザー確定）
    // EXP↑：さらに 0.82倍（=より育ちやすい）
    // EXP↓：さらに 1.18倍（=より育ちにくい）
    const extra =
      nature === "up" ? 0.82 :
      nature === "down" ? 1.18 :
      1.0;

    return base * extra;
  }

  // =========================
  // テーブル読み込み
  // =========================
  let expTable = null;   // nextLevel -> exp (base)
  let shardTable = null; // level -> shard per candy

async function loadTablesOnce() {
  if (expTable && shardTable) return;

  const [expTxt, shardTxt] = await Promise.all([
    fetch("./data/exp_table.txt", { cache: "no-store" }).then((r) => r.text()),
    fetch("./data/shard_table.txt", { cache: "no-store" }).then((r) => r.text()),
  ]);

  // EXP table は「5列」前提で読む（Lv / normal / 600 / semi / legend）
  expTable = parseExpTable(expTxt);

  // shard table は「2列」(Lv / shard) で読む
  shardTable = parseTwoColTable(shardTxt);
}

// 2列テーブル (key value) 用：カンマ対応
function parseTwoColTable(txt) {
  const map = new Map();
  txt.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s) return;
    if (s.startsWith("#")) return;

    const parts = s.split(/\s+/);
    if (parts.length < 2) return;

    const k = Number(parts[0]);
    const v = toNum(parts[1]); // カンマ対応

    if (!Number.isFinite(k) || !Number.isFinite(v)) return;
    map.set(k, v);
  });
  return map;
}

// EXP table (Lv, normal, 600, semi, legend) 用：カンマ対応
function parseExpTable(txt) {
  const map = new Map();

  txt.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s) return;
    if (s.startsWith("#")) return;

    // タブ区切り/スペース区切り両対応
    const parts = s.split(/\s+/);
    if (parts.length < 2) return;

    const lv = Number(parts[0]);
    if (!Number.isFinite(lv)) return;

    // 形式A：2列（もし将来2列で来ても動くように）
    // lv exp
    if (parts.length === 2) {
      const v = toNum(parts[1]);
      if (Number.isFinite(v)) map.set(lv, v);
      return;
    }

    // 形式B：5列（Lv / normal / 600 / semi / legend）
    // 例：47 1,015 1,522 1,827 2,233
    const normal = toNum(parts[1]);
    const t600   = toNum(parts[2]);
    const semi   = toNum(parts[3]);
    const legend = toNum(parts[4]);

    // どれかが取れればOK（全部0は弾く）
    if (!(Number.isFinite(normal) && Number.isFinite(t600) && Number.isFinite(semi) && Number.isFinite(legend))) return;

    map.set(lv, { normal, "600": t600, semi, legend });
  });

  return map;
}

  // =========================
  // 計算コア
  // =========================
  function clampInt(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function ceilDiv(a, b) {
    if (b <= 0) return Infinity;
    return Math.ceil(a / b);
  }

  // 「今のLv→目標Lv」までの累計必要EXP（タイプ倍率込み）
  function calcTotalNeedExp(lvNow, lvTarget, typeKey) {
    let sum = 0;
  
    for (let to = lvNow + 1; to <= lvTarget; to++) {
      const row = expTable.get(to);
      if (!row) throw new Error(`EXP tableにLv${to}が見つかりません`);
  
      const baseExp =
        typeof row === "number"
          ? row
          : (row[typeKey] ?? row.normal);
  
      sum += baseExp;
    }
    return Math.round(sum);
  }


  // レベルアップを「低レベルから順に」シミュレートして、
  // 必要アメ数と必要かけらを出す（ブースト対応・EXP持ち越し対応・かけら参照レベル修正）
  function simulateCandiesAndShards(opts) {
    const {
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      progressExp,     // 今Lv→次Lv に貯まっているEXP
      boostKind,       // "none" | "mini" | "full"
      boostCount,      // ブースト対象アメ数（低レベルから順に消費）
    } = opts;
  
    let candiesTotal = 0;
    let shardsTotal = 0;
  
    // 重要：現在レベルの「次Lvまでに貯まっているEXP」を初期値として持つ
    let expIntoNext = Math.max(0, Number(progressExp) || 0);
  
    let lv = lvNow;
    let boostRemain = Math.max(0, Number(boostCount) || 0);
  
    const boostExpMul = (boostKind === "mini" || boostKind === "full") ? 2 : 1;
    const boostShardMul = boostKind === "mini" ? 4 : (boostKind === "full" ? 5 : 1);
  
    while (lv < lvTarget) {
      const nextLv = lv + 1;
  
      // このレベル→次レベルに必要なEXP（タイプ別の列を直接使う）
      const row = expTable.get(nextLv);
      if (!row) throw new Error(`EXP tableにLv${nextLv}が見つかりません`);
  
      const needStep =
        typeof row === "number"
          ? row
          : (row[typeKey] ?? row.normal);
  
      // すでに貯まっている分を差し引いた「残り」
      let remain = needStep - expIntoNext;
  
      // 既に超えていたら、余りEXPを持ち越してレベルアップ
      if (remain <= 0) {
        lv = nextLv;
        expIntoNext = -remain; // 余りを次の段に持ち越し
        continue;
      }
  
      // 1個あたりEXP（レベル帯×性格×追加補正）
      // ※小数が出るので、ゲーム寄りに「アメ1個ごとに切り捨て」で扱う
      let perCandy = baseCandyExp(lv, natureKey);
  
      // ここが重要：ブーストは「アメ個数ぶん」だけ先に使う（低レベルから順）
      const isBoost = (boostRemain > 0 && boostKind !== "none");
      if (isBoost) boostRemain--;
  
      // 1個ぶんの獲得EXP（ブースト含む）
      let gain = perCandy * (isBoost ? boostExpMul : 1);
  
      // 丸め：アメ1個ごとに切り捨て（小数EXPは出ない想定に寄せる）
      gain = Math.floor(gain);
      if (gain <= 0) gain = 1; // 念のため
  
      // かけら単価は「到達レベル側」を参照（LvX→X+1なら shard[X+1]）
      const shardPer = shardTable.get(nextLv) || 0;
  
      // かけら（ブースト倍率）
      const shardCost = shardPer * (isBoost ? boostShardMul : 1);
  
      // アメ1個使う
      candiesTotal += 1;
      shardsTotal += shardCost;
      expIntoNext += gain;
  
      // 次のループで remain<=0 になれば自動でLvUP＆余り持ち越しされます
    }
  
    return {
      candiesTotal: Math.trunc(candiesTotal),
      shardsTotal: Math.trunc(Math.round(shardsTotal)),
    };
  }


  // =========================
  // UI
  // =========================
  function el(id) { return document.getElementById(id); }

  function getRadio(name) {
    const c = document.querySelector(`input[name="${name}"]:checked`);
    return c ? c.value : null;
  }

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

  function buildResultRow(key, val) {
    return `<div class="lvResRow"><div class="lvResKey">${key}</div><div class="lvResVal">${val}</div></div>`;
  }

  async function onCalc() {
    hideResult();

    // 入力取得
    const lvNow = clampInt(el("lvNow")?.value, LV_MIN, LV_MAX);
    const lvTarget = clampInt(el("lvTarget")?.value, 2, LV_MAX);

    const natureKey = getRadio("lvNature") || "none";
    const typeKey = getRadio("lvType") || "normal";

    const progressExp = clampInt(el("lvProgressExp")?.value || 0, 0, 9999);
    const candyOwned = clampInt(el("lvCandyOwned")?.value || 0, 0, 9999);

    const boost = clampInt(el("lvBoost")?.value || 0, 0, 999);
    const mini = clampInt(el("lvMiniBoost")?.value || 0, 0, 999);

    // バリデーション
    const errs = [];
    if (!lvNow) errs.push("今のレベルを入力してください");
    if (!lvTarget) errs.push("目標レベルを入力してください");
    if (lvTarget <= lvNow) errs.push("目標レベルは「今のレベル」より大きくしてください");

    if (boost > 0 && mini > 0) errs.push("アメブースト と ミニアメブースト は同時に入力できません");

    if (errs.length) {
      showResult(`<div class="lvResTitle">入力エラー</div><div class="lvlWarn">${errs.join("<br>")}</div>`);
      return;
    }

    await loadTablesOnce();

    // ① 必要経験値（累計）→ progress を差し引いた「残り必要経験値」
    const totalNeedExp = calcTotalNeedExp(lvNow, lvTarget, typeKey);
    const remainNeedExp = Math.max(0, totalNeedExp - progressExp);

    // ② ブースト指定
    let boostKind = "none";
    let boostCount = 0;
    if (mini > 0) { boostKind = "mini"; boostCount = mini; }
    if (boost > 0) { boostKind = "full"; boostCount = boost; }

    // ③ アメ数＆かけら：progress を考慮した上でシミュレーション
    const sim = simulateCandiesAndShards({
      lvNow,
      lvTarget,
      typeKey,
      natureKey,
      progressExp,
      boostKind,
      boostCount,
    });

    // ④ 所持アメで差し引き（負なら0）
    const candiesNeedAfterOwned = Math.max(0, sim.candiesTotal - candyOwned);

    // 表示
    const html = [
      `<div class="lvResTitle">計算結果</div>`,
      buildResultRow("必要経験値（累計）", `${totalNeedExp.toLocaleString()} EXP`),
      buildResultRow("必要経験値（差引後）", `${remainNeedExp.toLocaleString()} EXP`),
      buildResultRow("必要なアメ数（合計）", `${sim.candiesTotal.toLocaleString()} 個`),
      buildResultRow("必要なアメ数（所持分差引後）", `${candiesNeedAfterOwned.toLocaleString()} 個`),
      buildResultRow("必要なゆめのかけら量", `${sim.shardsTotal.toLocaleString()} 個`),
    ].join("");

    showResult(html);
  }

  function onClear() {
    ["lvNow","lvTarget","lvProgressExp","lvCandyOwned","lvBoost","lvMiniBoost"].forEach((id) => {
      const x = el(id);
      if (x) x.value = "";
    });

    const n0 = document.querySelector(`input[name="lvNature"][value="none"]`);
    const t0 = document.querySelector(`input[name="lvType"][value="normal"]`);
    if (n0) n0.checked = true;
    if (t0) t0.checked = true;

    hideResult();
  }

  function bindOnce() {
    const calcBtn = el("lvCalc");
    const clearBtn = el("lvClear");
    if (calcBtn) calcBtn.onclick = onCalc;
    if (clearBtn) clearBtn.onclick = onClear;

    // 25/30/50/60 ボタン
    document.querySelectorAll(".lvlQuickBtn").forEach((b) => {
      b.onclick = () => {
        const v = Number(b.dataset.lv);
        const t = el("lvTarget");
        if (t) t.value = String(v);
      };
    });

    // ブースト同時入力禁止：入力時に片方を自動クリア
    const boost = el("lvBoost");
    const mini = el("lvMiniBoost");
    if (boost && mini) {
      boost.addEventListener("input", () => {
        if (Number(boost.value) > 0) mini.value = "";
      });
      mini.addEventListener("input", () => {
        if (Number(mini.value) > 0) boost.value = "";
      });
    }
  }

  // public
  window.LevelTab = {
    init: function () {
      // 何度呼ばれても問題ないように軽く
      if (window.__LEVEL_TAB_BOUND__) return;
      window.__LEVEL_TAB_BOUND__ = true;
      bindOnce();
    },
  };
})();


