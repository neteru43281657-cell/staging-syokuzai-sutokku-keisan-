// calendar.js
"use strict";

const HOLIDAYS_2026 = [
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
  "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23"
];
const FULL_MOONS = ["2026-01-03", "2026-02-02", "2026-03-03", "2026-04-02", "2026-05-02", "2026-05-31", "2026-06-30", "2026-07-29", "2026-08-28", "2026-09-27", "2026-10-26", "2026-11-24", "2026-12-24"];
const NEW_MOONS = ["2026-01-19", "2026-02-17", "2026-03-19", "2026-04-17", "2026-05-17", "2026-06-15", "2026-07-14", "2026-08-13", "2026-09-11", "2026-10-11", "2026-11-09", "2026-12-09"];

const calEl = (id) => document.getElementById(id);

// 判定用：特定の日付が満月/新月リストの前後1日（計3日間）に含まれるか
function getMoonType(dateStr) {
  if (isAroundTarget(dateStr, FULL_MOONS)) return "gsd";
  if (isAroundTarget(dateStr, NEW_MOONS)) return "nmd";
  return null;
}

function isAroundTarget(dateStr, targetArray) {
  const date = new Date(dateStr);
  return targetArray.some(target => {
    const tDate = new Date(target);
    const diff = Math.abs(date - tDate) / (1000 * 60 * 60 * 24);
    return diff <= 1.1; // 浮動小数点の誤差考慮
  });
}

function renderYearCalendar() {
  const container = document.getElementById("yearCalendar");
  if (!container) return;

  const year = 2026;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dows = ["月", "火", "水", "木", "金", "土", "日"];
  
  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "8px";

  for (let m = 0; m < 12; m++) {
    let html = `
      <div class="month-card" style="padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: #fff;">
        <div class="month-name" style="font-size: 11px; font-weight: 900; text-align: center; margin-bottom: 4px; color: var(--main); border-bottom: 1.5px solid var(--main-soft);">${m + 1}月</div>
        <div class="days-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0;">
    `;

    dows.forEach((d, idx) => {
      let color = "var(--muted)";
      if (idx === 5) color = "#007bff";
      if (idx === 6) color = "#e74c3c";
      html += `<div style="font-size: 8px; font-weight: 900; text-align: center; color: ${color}; transform: scale(0.8);">${d}</div>`;
    });

    const firstDayIdx = new Date(year, m, 1).getDay(); 
    let offset = (firstDayIdx === 0) ? 6 : firstDayIdx - 1;
    const lastDate = new Date(year, m + 1, 0).getDate();

    for (let i = 0; i < offset; i++) html += `<div></div>`;

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, m, d).getDay();
      const moonType = getMoonType(dateStr);
      
      let baseStyle = "font-size: 9px; width: 100%; height: 18px; display: flex; align-items: center; justify-content: center; font-weight: 800; position: relative;";
      
      // カラーリング設定
      let color = "var(--text)";
      if (dayOfWeek === 6) {
        color = "#007bff"; // 土曜
      } else if (dayOfWeek === 0) {
        color = "#e74c3c"; // 日曜
      }

      // 祝日の上書き判定（日曜よりも優先してオレンジに）
      if (HOLIDAYS_2026.includes(dateStr)) {
        color = "#ff8c00"; // 鮮やかなオレンジ
      }

      let bgStyle = "";
      if (moonType) {
        const bgColor = moonType === "gsd" ? "#add8e6" : "#000080";
        color = moonType === "gsd" ? "#000" : "#fff";

        const prevStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`;
        const nextStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
        const hasPrev = getMoonType(prevStr) === moonType && d > 1;
        const hasNext = getMoonType(nextStr) === moonType && d < lastDate;

        let radius = "10px";
        if (hasPrev && hasNext) radius = "0";
        else if (hasPrev) radius = "0 10px 10px 0";
        else if (hasNext) radius = "10px 0 0 10px";

        bgStyle = `background: ${bgColor}; border-radius: ${radius};`;
      }

      let todayBorder = "";
      if (dateStr === todayStr) {
        todayBorder = "outline: 1.5px solid #ff4757; outline-offset: -1.5px; border-radius: 4px; z-index: 5;";
      }

      html += `<div style="${baseStyle} ${bgStyle} ${todayBorder} color: ${color};">${d}</div>`;
    }
    html += `</div></div>`;
    container.innerHTML += html;
  }
}

window.CalendarTab = { renderYearCalendar };
