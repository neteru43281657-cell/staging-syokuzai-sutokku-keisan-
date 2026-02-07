// pokedex.js
"use strict";

const pokEl = (id) => document.getElementById(id);
function imgSrc(file) { return "images/" + encodeURIComponent(file); }

// caches
let POKE_LIST = null;     
let POKE_MAP = null;      
let SKILL_MAP = null;     
let TYPE_ICON_MAP = null; 
let ENERGY_MAP = null;
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

async function loadTypeIcons() {
  if (TYPE_ICON_MAP) return TYPE_ICON_MAP;
  try {
    const text = await fetchText("typeicon.txt");
    const map = new Map();
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t").map(s => s.trim());
      if (cols.length >= 2 && cols[0]) {
        map.set(cols[0], { typeIcon: cols[1] });
      }
    }
    TYPE_ICON_MAP = map;
  } catch (e) {
    console.warn("Type icon load failed", e);
    TYPE_ICON_MAP = new Map();
  }
  return TYPE_ICON_MAP;
}

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

  const tsv = await fetchText("pokedex_master.txt");
  const lines = tsv.split(/\r?\n/).filter(Boolean);

  const list = [];
  const map = new Map();

  for (let i = 1; i < lines.length; i++) {
    // 空欄があっても列がズレないように単純分割
    const cols = lines[i].split("\t").map(s => s.trim());
    
    if (cols.length < 5) continue;

    const p = {
      id: cols[0],
      name: cols[1],
      typeName: cols[2] || "-",
      evo: Number(cols[3]) || 1, 
      type: cols[4],
      sleep: cols[5],
      helpTime: Number(cols[6]) || 0,
      ingProb: Number(cols[7]) || 0,
      skillProb: Number(cols[8]) || 0,
      skillName: cols[9] || "-",
      ing1: cols[10] || "-",
      ing2: cols[11] || "-",
      ing3: cols[12] || "-",
      carry: Number(cols[13]) || 0,
      file: `${cols[0]}.webp`,
      variations: [] 
    };

    if (map.has(p.name)) {
      const parent = map.get(p.name);
      parent.variations.push(p);
    } else {
      p.variations.push(p);
      list.push(p);
      map.set(p.name, p);
    }
  }

  POKE_LIST = list;
  POKE_MAP = map;
  calcAverages();
  return { list, map };
}

function calcAverages() {
  const sums = {}; 
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
      STATS_AVG[k] = { ing: d.iSum / d.count, skill: d.sSum / d.count };
    }
  });
}

async function loadEnergyMap() {
  if (ENERGY_MAP) return ENERGY_MAP;
  const text = await fetchText("energy.txt");
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

function sortByDexOrder(names, pokeList) {
  const dexOrderMap = new Map();
  pokeList.forEach((p, i) => dexOrderMap.set(p.name, i));
  const base = [...names].sort((a, b) => {
    const ai = dexOrderMap.has(a) ? dexOrderMap.get(a) : 99999;
    const bi = dexOrderMap.has(b) ? dexOrderMap.get(b) : 99999;
    return ai - bi;
  });
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

function buildPokemonGridHTML(label, badgeClass, names, pokeMap, pokeList) {
  const sorted = sortByDexOrder(names, pokeList);

  const items = sorted.map(name => {
    const p = pokeMap.get(name);
    const src = p ? imgSrc(p.file) : "";
    const imgHtml = p
      ? `<img src="${src}" alt="${name}">`
      : `<div style="width:100%; aspect-ratio:1; border:1px dashed #ccc; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:8px; color:#999;">no img</div>`;
    
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

async function showFieldDetail(fieldId, opts = {}) {
  const fromPop = !!opts.fromPop;
  const field = FIELDS.find(f => f.id === fieldId);
  pokEl("fieldMenu").style.display = "none";
  pokEl("fieldDetail").style.display = "block";

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
    await loadTypeIcons(); 
    const energyMap = await loadEnergyMap();
    const pokeBySleep = await loadFieldPokemon(field.name);

    const eRows = energyMap.get(field.name) || [];
    const eTrs = eRows.filter(r => r.count >= 4 && r.count <= 8)
      .map(r => `<tr><td style="font-weight:900;">${r.count}体</td><td style="font-weight:900;">${r.energyText}</td></tr>`).join("");
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

function getIngIcon(name) {
  if (!window.INGREDIENTS) return "";
  const found = window.INGREDIENTS.find(i => i.name === name);
  return found ? imgSrc(found.file) : "";
}

async function openDetail(name) {
  const { map } = await loadPokemonMaster();
  const skills = await loadSkillData();
  const typeIcons = await loadTypeIcons(); 

  const p = map.get(name);
  if (!p) return;

  const modal = pokEl("pokeDetailModal");
  const body = pokEl("pokeDetailBody");

  const skillUrl = skills.get(p.skillName) || null;
  const skillHtml = skillUrl 
    ? `<a href="${skillUrl}" target="_blank" style="color:var(--main); text-decoration:underline; font-weight:900;">${p.skillName} <span style="font-size:10px;">↗</span></a><br><span style="font-size:10px; color:var(--muted); font-weight:normal;">※外部Wikiへ遷移します</span>`
    : p.skillName;

  const avgKey = `${p.type}_${p.evo}`;
  const avg = STATS_AVG ? STATS_AVG[avgKey] : null;

  let typeClass = "type-berry";
  if (p.type === "食材") typeClass = "type-ing";
  if (p.type === "スキル") typeClass = "type-skill";

  const tInfo = typeIcons.get(p.typeName);
  const typeIconHtml = tInfo ? `<img src="${imgSrc(tInfo.typeIcon)}" style="width:14px; height:14px;">` : "";
  
  const makeBar = (label, val, avgVal, unit) => {
    const max = Math.max(val, avgVal || 0) * 1.2 || 1; 
    const w1 = Math.min(100, (val / max) * 100);
    const w2 = Math.min(100, (avgVal / max) * 100);
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
        <div style="background:#f0f0f0; height:6px; border-radius:3px; overflow:hidden; margin-bottom:2px;">
           <div style="width:${w2}%; background:${col2}; height:100%;"></div>
        </div>
        <div style="font-size:9px; color:var(--muted); text-align:right;">同タイプ平均：${avgVal.toFixed(1)}${unit}</div>
        ` : ""}
      </div>
    `;
  };

  const makeIngItem = (name) => {
    // ★「なし」変換ロジック
    // 空欄、"-"、null などを全て「なし」という文字として扱う
    let dispName = name;
    if (!dispName || dispName === "-" || dispName.trim() === "") {
      dispName = "なし";
    }

    const icon = getIngIcon(name); // 元の名前（キー）で画像検索
    
    // アイコンがあれば画像、なければ「なし」などの文字を表示
    return `
      <div class="ing-item">
        ${icon 
          ? `<img src="${icon}" class="ing-icon">` 
          : `<span class="ing-name" style="font-size:10px; color:var(--muted);">${dispName}</span>`
        }
      </div>
    `;
  };

  const sizeLabels = ["小", "中", "大", "特大"];

  let statsHtml = "";
  if (p.variations.length > 1) {
    const trs = p.variations.map((v, idx) => {
      const label = sizeLabels[idx] || `#${idx+1}`;
      return `
      <tr>
        <td style="font-weight:900;">${label}</td>
        <td>${v.helpTime}秒</td>
        <td>${v.ingProb}%</td>
        <td>${v.skillProb}%</td>
        <td>${v.carry}個</td>
      </tr>
      `;
    }).join("");
    
    statsHtml = `
      <div style="margin-bottom:12px; overflow-x:auto;">
        <table style="width:100%; font-size:11px; border-collapse:collapse; text-align:center;" class="poke-vars-table">
          <thead>
            <tr style="background:#f0f2f5; color:var(--muted);">
              <th style="padding:4px;">個体</th>
              <th style="padding:4px;">時間</th>
              <th style="padding:4px;">食材</th>
              <th style="padding:4px;">スキル</th>
              <th style="padding:4px;">所持数</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    `;
  } else {
    statsHtml = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div style="background:#f8f9fa; padding:10px; border-radius:12px; text-align:center;">
          <div style="font-size:10px; color:var(--muted); font-weight:700;">おてつだい時間</div>
          <div style="font-size:15px; font-weight:900;">${p.helpTime}秒</div>
        </div>
        <div style="background:#f8f9fa; padding:10px; border-radius:12px; text-align:center;">
          <div style="font-size:10px; color:var(--muted); font-weight:700;">最大所持数</div>
          <div style="font-size:15px; font-weight:900;">${p.carry}個</div>
        </div>
      </div>
      
      <div style="border-top:1px solid var(--line); padding-top:12px; margin-bottom:12px;">
        ${makeBar("食材確率", p.ingProb, avg?.ing, "%")}
        ${makeBar("スキル確率", p.skillProb, avg?.skill, "%")}
      </div>
    `;
  }

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px;">
      <img src="${imgSrc(p.file)}" style="width:72px; height:72px; object-fit:contain; border:1px solid var(--line); border-radius:16px; background:#fff;">
      <div>
        <div class="type-badge-row">
          <div class="element-type">
            ${typeIconHtml}
            <span>${p.typeName}</span>
          </div>
          <span class="type-badge ${typeClass}" style="font-size:11px; padding:2px 10px; min-width:auto;">${p.type}</span>
        </div>

        <div style="font-size:20px; font-weight:900; line-height:1.2;">
          ${p.name}
        </div>
      </div>
    </div>

    ${statsHtml}

    <div style="border-top:1px solid var(--line); padding-top:16px;">
      <div style="margin-bottom:16px;">
        <div style="font-size:11px; color:var(--muted); font-weight:700; margin-bottom:4px;">食材</div>
        <div class="ing-list">
           ${makeIngItem(p.ing1)}
           ${makeIngItem(p.ing2)}
           ${makeIngItem(p.ing3)}
        </div>
      </div>

      <div>
        <div style="font-size:11px; color:var(--muted); font-weight:700; margin-bottom:8px;">メインスキル</div>
        <div style="font-size:14px; font-weight:900; line-height:1.4;">${skillHtml}</div>
      </div>
    </div>
  `;

  modal.style.display = "flex";
}

const closeBtn = pokEl("closePokeDetail");
if (closeBtn) closeBtn.onclick = () => pokEl("pokeDetailModal").style.display = "none";

const modalEl = pokEl("pokeDetailModal");
if (modalEl) modalEl.onclick = (e) => {
  if (e.target === modalEl) modalEl.style.display = "none";
};

/* =========================================================
   共通エクスポート
========================================================= */
function renderFieldMenu() {
  pokEl("fieldMenu").style.display = "block";
  pokEl("fieldDetail").style.display = "none";
  const grid = document.querySelector(".field-grid");
  if (grid) {
    grid.innerHTML = FIELDS.map(field => `
      <div class="field-item" onclick="window.PokedexTab.showFieldDetail('${field.id}')">
        <img src="images/${field.file}" class="field-img">
        <div class="field-name">${field.name}</div>
      </div>
    `).join("");
  }
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
  pokEl("pokeDetailModal").style.display = "none";
  if (!viaPop) {
    const st = history.state?.pokedex;
    if (st?.view === "detail") {
      try { history.back(); return; } catch (_) {}
    }
    replaceMenuState();
  }
}

window.addEventListener("popstate", (e) => {
  const st = e.state?.pokedex;
  const modal = pokEl("pokeDetailModal");
  if (modal && modal.style.display !== "none") {
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
