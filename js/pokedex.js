// pokedex.js
"use strict";

const pokEl = (id) => document.getElementById(id);
function imgSrc(file) { return "images/" + encodeURIComponent(file); }

// caches
let POKE_LIST = null;     // 配列: 全ポケモンのデータオブジェクト
let POKE_MAP = null;      // Map: 名前 -> データオブジェクト
let SKILL_MAP = null;     // Map: スキル名 -> URL
let ENERGY_MAP = null;

// 平均値キャッシュ { type: { 1: {ing, skill}, 2:..., 3:... } }
let STATS_AVG = null;

const DEX_ORDER_OVERRIDES = [
    { name: "ストリンダー（ロー）", after: "ストリンダー（ハイ）" },
    { name: "ウパー（パルデア）", before: "ドオー" },
    { name: "ロコン（アローラ）", after: "ロコン" },
    { name: "キュウコン（アローラ）", after: "キュウコン" }
];

async function fetchText(path) {
  const res = await fetch("data/" + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch: ${path}`);
  return await res.text();
}

/* =========================================================
   データ読み込み関連
========================================================= */
async function loadSkillData() {
  if (SKILL_MAP) return SKILL_MAP;
  try {
    const text = await fetchText("skill_data.txt");
    const map = new Map();
    text.split(/\r?\n/).forEach(line => {
      const cols = line.trim().split(/\t+/);
      if (cols.length >= 2) {
        map.set(cols[0].trim(), cols[1].trim());
      }
    });
    SKILL_MAP = map;
  } catch (e) {
    console.warn("Skill data load failed", e);
    SKILL_MAP = new Map();
  }
  return SKILL_MAP;
}

async function loadPokemonMaster() {
  if (POKE_LIST) return { list: POKE_LIST, map: POKE_MAP };

  // 新しい pokedex_master.txt (= pokemon_stats.txtの中身) を読む
  // 列: ID, 名前, 進化, とくい, 睡眠, 時間, 食材率, スキル率, スキル名, 食材1, 2, 3, 所持
  const tsv = await fetchText("pokedex_master.txt");
  const lines = tsv.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const list = [];
  const map = new Map();

  // 1行目はヘッダーなのでスキップ
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\t+/);
    if (cols.length < 3) continue;

    const p = {
      id: cols[0], // ファイル名(拡張子なし)
      name: cols[1],
      evo: Number(cols[2]) || 1,
      type: cols[3], // 食材/きのみ/スキル
      sleep: cols[4],
      helpTime: Number(cols[5]) || 0,
      ingProb: Number(cols[6]) || 0,
      skillProb: Number(cols[7]) || 0,
      skillName: cols[8] || "-",
      ing1: cols[9] || "-",
      ing2: cols[10] || "-",
      ing3: cols[11] || "-",
      carry: Number(cols[12]) || 0,
      
      // 画像パスは固定で .webp を付与
      file: `${cols[0]}.webp`
    };

    list.push(p);
    map.set(p.name, p);
  }

  POKE_LIST = list;
  POKE_MAP = map;
  
  // 平均値の計算
  calcAverages();

  return { list, map };
}

function calcAverages() {
  // タイプ別・進化段階別の合計とカウント
  const sums = {}; // keys: "食材_1", "きのみ_2" etc

  POKE_LIST.forEach(p => {
    if (!p.type || !p.evo) return;
    const key = `${p.type}_${p.evo}`;
    if (!sums[key]) sums[key] = { iSum:0, sSum:0, count:0 };
    
    sums[key].iSum += p.ingProb;
    sums[key].sSum += p.skillProb;
    sums[key].count++;
  });

  STATS_AVG = {};
  Object.keys(sums).forEach(k => {
    const d = sums[k];
    if (d.count > 0) {
      STATS_AVG[k] = {
        ing: d.iSum / d.count,
        skill: d.sSum / d.count
      };
    }
  });
}

async function loadEnergyMap() {
  if (ENERGY_MAP) return ENERGY_MAP;
  const text = await fetchText("energy.txt");
  // (中略: 既存ロジックと同じ)
  const lines = text.split(/\r?\n/);
  const map = new Map();
  let currentField = null;
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes("\t") && !line.includes("ポケモン数") && line !== "...") {
      currentField = line; inTable = false; 
      if (!map.has(currentField)) map.set(currentField, []);
      continue;
    }
    if (!currentField) continue;
    if (line.startsWith("ポケモン数")) { inTable = true; continue; }
    if (!inTable) continue;
    if (line === "...") continue;
    const cols = line.split(/\t+/);
    if (cols.length < 2) continue;
    const count = Number(cols[0]);
    const energyText = (cols[1] || "").trim();
    if (!Number.isFinite(count)) continue;
    map.get(currentField).push({ count, energyText: energyText || "-" });
  }
  ENERGY_MAP = map;
  return ENERGY_MAP;
}

async function loadFieldPokemon(fieldName) {
  // 既存のフィールド出現リスト（名前だけのリスト）
  const text = await fetchText(`${fieldName}.txt`);
  const lines = text.split(/\r?\n/);
  const result = { "うとうと": [], "すやすや": [], "ぐっすり": [] };
  let mode = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("・")) {
      const key = line.replace(/^・/, "").trim();
      mode = (key in result) ? key : null;
      continue;
    }
    if (!mode) continue;
    result[mode].push(line);
  }
  return result;
}

/* =========================================================
   表示ロジック
========================================================= */

// 図鑑順ソート
function sortByDexOrder(names, pokeList) {
  // 名前リストを、POKE_LISTの並び順（＝図鑑順）に合わせてソート
  const dexOrderMap = new Map();
  pokeList.forEach((p, i) => dexOrderMap.set(p.name, i));

  const base = [...names].sort((a, b) => {
    const ai = dexOrderMap.has(a) ? dexOrderMap.get(a) : 99999;
    const bi = dexOrderMap.has(b) ? dexOrderMap.get(b) : 99999;
    return ai - bi;
  });

  // 例外ルール適用
  DEX_ORDER_OVERRIDES.forEach(rule => {
    const idx = base.indexOf(rule.name);
    if (idx === -1) return;
    base.splice(idx, 1);
    if (rule.after) {
      const targetIdx = base.indexOf(rule.after);
      if (targetIdx !== -1) base.splice(targetIdx + 1, 0, rule.name);
      else base.push(rule.name);
    } else if (rule.before) {
      const targetIdx = base.indexOf(rule.before);
      if (targetIdx !== -1) base.splice(targetIdx, 0, rule.name);
      else base.push(rule.name);
    }
  });
  return base;
}

// 一覧HTML生成
function buildPokemonGridHTML(label, badgeClass, names, pokeMap, pokeList) {
  const sorted = sortByDexOrder(names, pokeList);

  const items = sorted.map(name => {
    const p = pokeMap.get(name);
    const src = p ? imgSrc(p.file) : "";
    
    // 画像がない場合のダミー
    const imgHtml = p
      ? `<img src="${src}" alt="${name}">`
      : `<div style="width:44px;height:44px;border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:8px;color:var(--muted);">no img</div>`;

    // クリックイベント追加
    return `
      <div class="poke-item" title="${name}" onclick="window.PokedexTab.openDetail('${name}')">
        ${imgHtml}
        <div class="poke-name">${name}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="sleep-section">
      <div class="sleep-label">
        <span class="sleep-badge ${badgeClass}">${label}</span>
        <span style="font-size:12px; color:var(--muted); font-weight:900;">${sorted.length}種</span>
      </div>
      <div class="poke-grid">${items}</div>
    </div>
  `;
}

// 詳細画面（Fieldメニュー）
async function showFieldDetail(fieldId, opts = {}) {
  const fromPop = !!opts.fromPop;
  const field = FIELDS.find(f => f.id === fieldId);
  pokEl("fieldMenu").style.display = "none";
  pokEl("fieldDetail").style.display = "block";

  // ローディング
  pokEl("detailContent").innerHTML = `
    <div class="card" style="text-align:center;">
      <div style="font-weight:900;">読み込み中...</div>
    </div>`;

  if (!fromPop) {
    try {
      const st = history.state || {};
      history.pushState({ ...st, pokedex: { view: "detail", fieldId } }, "", location.href);
    } catch (_) {}
  }

  try {
    const { list, map } = await loadPokemonMaster();
    const energyMap = await loadEnergyMap();
    const pokeBySleep = await loadFieldPokemon(field.name);

    // エナジー表作成
    const eRows = energyMap.get(field.name) || [];
    const eTrs = eRows.filter(r => r.count >= 4 && r.count <= 8)
      .map(r => `<tr><td>${r.count}体</td><td>${r.energyText}</td></tr>`).join("");
    const energyHtml = eTrs ? `
      <table class="energy-table">
        <thead><tr><th>出現ポケモン数</th><th>必要エナジー</th></tr></thead>
        <tbody>${eTrs}</tbody>
      </table>` : "";

    const headerHtml = `
      <div class="card">
        <div class="field-header">
          <img src="images/${field.file}" alt="${field.name}">
          <div class="field-title">${field.name}</div>
        </div>
        ${energyHtml}
      </div>
    `;

    const uto = buildPokemonGridHTML("うとうと", "badge-uto", pokeBySleep["うとうと"], map, list);
    const suya = buildPokemonGridHTML("すやすや", "badge-suya", pokeBySleep["すやすや"], map, list);
    const gusu = buildPokemonGridHTML("ぐっすり", "badge-gusu", pokeBySleep["ぐっすり"], map, list);

    pokEl("detailContent").innerHTML = `
      ${headerHtml}
      ${uto}
      ${suya}
      ${gusu}
    `;
  } catch (err) {
    pokEl("detailContent").innerHTML = `
      <div class="card"><div style="color:red;">読み込み失敗: ${err}</div></div>`;
  }
}

/* =========================================================
   ポケモン詳細モーダル関連
========================================================= */
async function openDetail(name) {
  const { map } = await loadPokemonMaster();
  const skills = await loadSkillData();
  const p = map.get(name);
  if (!p) return;

  const modal = pokEl("pokeDetailModal");
  const body = pokEl("pokeDetailBody");

  // スキルリンク
  const skillUrl = skills.get(p.skillName) || null;
  const skillHtml = skillUrl 
    ? `<a href="${skillUrl}" target="_blank" style="color:var(--main); text-decoration:underline;">${p.skillName} <span style="font-size:10px;">↗</span></a>`
    : p.skillName;

  // 平均比較データ
  const avgKey = `${p.type}_${p.evo}`;
  const avg = STATS_AVG ? STATS_AVG[avgKey] : null;

  // グラフ描画ヘルパー
  const makeBar = (label, val, avgVal, unit) => {
    // グラフの最大値を、本人と平均の大きい方の1.2倍くらいにする
    const max = Math.max(val, avgVal || 0) * 1.2 || 1; 
    const w1 = Math.min(100, (val / max) * 100);
    const w2 = Math.min(100, (avgVal / max) * 100);
    
    // 色: タイプ別などにしても良いがシンプルに
    const col1 = "#007bff"; 
    const col2 = "#bdc3c7"; 

    return `
      <div style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:700; margin-bottom:4px; display:flex; justify-content:space-between;">
          <span>${label}</span>
          <span>${val}${unit}</span>
        </div>
        <div style="background:#f0f0f0; height:8px; border-radius:4px; overflow:hidden; margin-bottom:4px;">
          <div style="width:${w1}%; background:${col1}; height:100%;"></div>
        </div>
        ${avgVal ? `
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; background:#f0f0f0; height:6px; border-radius:3px; overflow:hidden;">
            <div style="width:${w2}%; background:${col2}; height:100%;"></div>
          </div>
          <div style="font-size:9px; color:var(--muted);">同タイプ進化Lv${p.evo}平均: ${avgVal.toFixed(1)}${unit}</div>
        </div>
        ` : ""}
      </div>
    `;
  };

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px;">
      <img src="${imgSrc(p.file)}" style="width:64px; height:64px; object-fit:contain; border:1px solid var(--line); border-radius:12px; background:#f8f9fa;">
      <div>
        <div style="font-size:18px; font-weight:900;">${p.name}</div>
        <div style="display:flex; gap:6px; margin-top:4px;">
           <span class="badge" style="background:#eee; color:#333;">${p.type}</span>
           ${p.evo ? `<span class="badge" style="background:#eee; color:#333;">${p.evo}進化</span>` : ""}
        </div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;">
      <div style="background:#f8f9fa; padding:8px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:var(--muted); font-weight:700;">おてつだい時間</div>
        <div style="font-size:14px; font-weight:900;">${p.helpTime}秒</div>
      </div>
      <div style="background:#f8f9fa; padding:8px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:var(--muted); font-weight:700;">最大所持数</div>
        <div style="font-size:14px; font-weight:900;">${p.carry}個</div>
      </div>
    </div>

    <div style="border-top:1px solid var(--line); padding-top:12px; margin-bottom:12px;">
      ${makeBar("食材確率", p.ingProb, avg?.ing, "%")}
      ${makeBar("スキル確率", p.skillProb, avg?.skill, "%")}
    </div>

    <div style="border-top:1px solid var(--line); padding-top:12px;">
      <div style="margin-bottom:10px;">
        <div style="font-size:11px; color:var(--muted); font-weight:700;">メインスキル</div>
        <div style="font-size:13px; font-weight:900;">${skillHtml}</div>
      </div>
      
      <div>
        <div style="font-size:11px; color:var(--muted); font-weight:700; margin-bottom:4px;">拾ってくる食材</div>
        <div style="font-size:12px; display:grid; grid-template-columns:auto 1fr; gap:6px 12px; align-items:center;">
           <span style="font-weight:700; color:#888;">Lv1</span> <span>${p.ing1}</span>
           <span style="font-weight:700; color:#888;">Lv30</span> <span>${p.ing2}</span>
           <span style="font-weight:700; color:#888;">Lv60</span> <span>${p.ing3}</span>
        </div>
      </div>
    </div>
  `;

  modal.style.display = "flex";
}

// 閉じる処理
pokEl("closePokeDetail").onclick = () => pokEl("pokeDetailModal").style.display = "none";
pokEl("pokeDetailModal").onclick = (e) => {
  if (e.target === pokEl("pokeDetailModal")) pokEl("pokeDetailModal").style.display = "none";
};


/* =========================================================
   共通エクスポート
========================================================= */
function renderFieldMenu() {
  pokEl("fieldMenu").style.display = "block";
  pokEl("fieldDetail").style.display = "none";
  const grid = document.querySelector(".field-grid");
  grid.innerHTML = FIELDS.map(field => `
    <div class="field-item" onclick="window.PokedexTab.showFieldDetail('${field.id}')">
      <img src="images/${field.file}" class="field-img">
      <div class="field-name">${field.name}</div>
    </div>
  `).join("");
  replaceMenuState();
}

function replaceMenuState() {
  try {
    const st = history.state || {};
    history.replaceState({ ...st, pokedex: { view: "menu", fieldId: null } }, "", location.href);
  } catch (_) {}
}

function backToMenu(viaPop = false) {
  pokEl("fieldMenu").style.display = "block";
  pokEl("fieldDetail").style.display = "none";
  pokEl("pokeDetailModal").style.display = "none"; // 詳細も閉じる
  if (!viaPop) {
    const st = history.state?.pokedex;
    if (st?.view === "detail") {
      try { history.back(); return; } catch (_) {}
    }
    replaceMenuState();
  }
}

// 履歴操作
window.addEventListener("popstate", (e) => {
  const st = e.state?.pokedex;
  
  // モーダルが開いていたら閉じるだけ
  const modal = pokEl("pokeDetailModal");
  if (modal.style.display !== "none") {
    modal.style.display = "none";
    return;
  }

  if (st?.view === "detail" && st.fieldId) {
    showFieldDetail(st.fieldId, { fromPop: true });
    return;
  }
  backToMenu(true);
});

window.PokedexTab = { renderFieldMenu, showFieldDetail, backToMenu, openDetail };
