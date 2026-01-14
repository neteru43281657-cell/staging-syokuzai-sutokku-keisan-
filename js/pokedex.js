// pokedex.js
"use strict";

const pokEl = (id) => document.getElementById(id);
function imgSrc(file) { return "images/" + encodeURIComponent(file); }

// caches
let POKE_MASTER = null;
let ENERGY_MAP = null;

const DEX_ORDER_OVERRIDES = [
    { name: "ストリンダー（ロー）", after: "ストリンダー（ハイ）" },
    { name: "ウパー（パルデア）", before: "ドオー" },
    { name: "ロコン（アローラ）", after: "ロコン" },
    { name: "キュウコン（アローラ）", after: "キュウコン" }
  ];

async function fetchText(path) {
  // data/配下に揃えたので、全部 data/ から読む
  const res = await fetch("data/" + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch: ${path}`);
  return await res.text();
}

async function loadPokemonMaster() {
  if (POKE_MASTER) return POKE_MASTER;

  const tsv = await fetchText("pokedex_master.txt");
  const lines = tsv.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // 1行目はヘッダー想定：ファイル名	ファイル形式	ポケモン名
  const orderMap = new Map();
  const fileMap = new Map();

  let idx = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\t+/);
    if (cols.length < 3) continue;
    const fileName = cols[0].trim();     // "1" や "37-1" や "ハロウィンイーブイ"
    const ext = cols[1].trim();          // "webp"
    const name = cols[2].trim();         // "フシギダネ" 等
    const file = `${fileName}.${ext}`;   // "1.webp"

    if (!orderMap.has(name)) {
      orderMap.set(name, idx++);
    }
    if (!fileMap.has(name)) {
      fileMap.set(name, file);
    }
  }

  POKE_MASTER = { orderMap, fileMap };
  return POKE_MASTER;
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

    // フィールド名行（例：ワカクサ本島）
    // 「ポケモン数」などの見出しではない、かつタブを含まない単独行をフィールド名扱い
    if (!line.includes("\t") && !line.includes("ポケモン数") && line !== "...") {
      currentField = line;
      inTable = false;
      if (!map.has(currentField)) map.set(currentField, []);
      continue;
    }

    if (!currentField) continue;

    // 見出し行
    if (line.startsWith("ポケモン数")) {
      inTable = true;
      continue;
    }

    if (!inTable) continue;

    // 例： 4	9,653
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

const FIELD_POKEMON_CACHE = new Map();

async function loadFieldPokemon(fieldName) {
  if (FIELD_POKEMON_CACHE.has(fieldName)) {
    return FIELD_POKEMON_CACHE.get(fieldName);
  }

  const text = await fetchText(`${fieldName}.txt`);
  const lines = text.split(/\r?\n/);

  const result = { "うとうと": [], "すやすや": [], "ぐっすり": [] };
  let mode = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("・")) {
      const key = line.replace(/^・/, "").trim();
      mode = result[key] ? key : null;
      continue;
    }

    if (mode) result[mode].push(line);
  }

  FIELD_POKEMON_CACHE.set(fieldName, result);
  return result;
}

function nextFrame() {
  return new Promise(resolve =>
    requestAnimationFrame(() => resolve())
  );
}

function sortByDexOrder(names, orderMap) {
  // まず通常の図鑑順
  const base = [...names].sort((a, b) => {
    const ai = orderMap.has(a) ? orderMap.get(a) : 1e9;
    const bi = orderMap.has(b) ? orderMap.get(b) : 1e9;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b, "ja");
  });

  // 例外ルールを適用
  DEX_ORDER_OVERRIDES.forEach(rule => {
    const idx = base.indexOf(rule.name);
    if (idx === -1) return;

    base.splice(idx, 1); // 一旦外す

    if (rule.after) {
      const targetIdx = base.indexOf(rule.after);
      if (targetIdx !== -1) {
        base.splice(targetIdx + 1, 0, rule.name);
      } else {
        base.push(rule.name);
      }
    } else if (rule.before) {
      const targetIdx = base.indexOf(rule.before);
      if (targetIdx !== -1) {
        base.splice(targetIdx, 0, rule.name);
      } else {
        base.push(rule.name);
      }
    }
  });

  return base;
}

function buildEnergyTableHTML(fieldName, energyMap) {
  const rows = energyMap.get(fieldName) || [];
  if (!rows.length) {
    return `<div style="font-size:12px; color:var(--muted); margin-top:8px;">出現ポケモン数の表データが見つかりませんでした。</div>`;
  }

  const trs = rows
    .filter(r => r.count >= 4 && r.count <= 8)
    .map(r => `<tr><td>${r.count}体</td><td>${r.energyText}</td></tr>`)
    .join("");

  return `
    <table class="energy-table">
      <thead><tr><th>出現ポケモン数</th><th>必要エナジー</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
  `;
}

function buildPokemonGridHTML(label, badgeClass, names, master) {
  const sorted = sortByDexOrder(names, master.orderMap);

  const items = sorted.map(name => {
    const file = master.fileMap.get(name);
    const src = file ? imgSrc(file) : "";
    const imgHtml = file
      ? `<img src="${src}" alt="${name}" loading="lazy" decoding="async">`
      : `<div style="width:44px;height:44px;border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);">no img</div>`;

    return `
      <div class="poke-item" title="${name}">
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

function renderFieldMenu() {
  const grid = document.querySelector(".field-grid");
  grid.innerHTML = FIELDS.map(field => `
    <div class="field-item" onclick="showFieldDetail('${field.id}')">
      <img src="images/${field.file}" class="field-img">
      <div class="field-name">${field.name}</div>
    </div>
  `).join("");
}

async function showFieldDetail(fieldId) {
  try {
    const field = FIELDS.find(f => f.id === fieldId);
    if (!field) return;

    const [master, energyMap] = await Promise.all([
      loadPokemonMaster(),
      loadEnergyMap()
    ]);

    // ① 先に軽いUI（ヘッダー＋エナジー表）
    detailContent.innerHTML = `
      <div class="card">
        <div class="field-header">
          <img src="images/${field.file}" loading="lazy" decoding="async">
          <div>
            <div class="field-title">${field.name}</div>
            <div class="field-sub">出現ポケモン数 / 必要エナジー</div>
          </div>
        </div>
        ${buildEnergyTableHTML(field.name, energyMap)}
      </div>

      <div id="pokeSections">
        <div class="card" style="text-align:center;">
          ポケモン一覧を読み込み中…
        </div>
      </div>
    `;

    await nextFrame();

    // ② 重いデータを後から
    const pokeBySleep = await loadFieldPokemon(field.name);
    const container = document.getElementById("pokeSections");

    let html = "";
    html += buildPokemonGridHTML("うとうと", "badge-uto", pokeBySleep["うとうと"], master);
    container.innerHTML = html;
    await nextFrame();

    html += buildPokemonGridHTML("すやすや", "badge-suya", pokeBySleep["すやすや"], master);
    container.innerHTML = html;
    await nextFrame();

    html += buildPokemonGridHTML("ぐっすり", "badge-gusu", pokeBySleep["ぐっすり"], master);
    container.innerHTML = html;

  } catch (e) {
    detailContent.innerHTML = `<div class="card">読み込みに失敗しました</div>`;
  }
}


function backToMenu() {
  pokEl("fieldMenu").style.display = "block";
  pokEl("fieldDetail").style.display = "none";
}

window.PokedexTab = { renderFieldMenu, showFieldDetail, backToMenu };
