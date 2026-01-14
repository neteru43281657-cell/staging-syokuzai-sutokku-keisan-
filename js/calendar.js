// calendar.js
"use strict";

// --- data ---
const HOLIDAYS_2026 = [
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
  "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23"
]
const FULL_MOONS = ["2026-01-03", "2026-02-02", "2026-03-03", "2026-04-02", "2026-05-02", "2026-05-31", "2026-06-30", "2026-07-29", "2026-08-28", "2026-09-27", "2026-10-26", "2026-11-24", "2026-12-24"]
const NEW_MOONS = ["2026-01-19", "2026-02-17", "2026-03-19", "2026-04-17", "2026-05-17", "2026-06-15", "2026-07-14", "2026-08-13", "2026-09-11", "2026-10-11", "2026-11-09", "2026-12-09"]

// --- helpers ---
const calEl = (id) => document.getElementById(id);

function isAround(dateStr, targetArray) {
  const date = new Date(dateStr);
  return targetArray.some(target => {
    const tDate = new Date(target);
    const diff = Math.abs(date - tDate) / (1000 * 60 * 60 * 24);
    return diff <= 1;
  });
}

function renderYearCalendar() {
  const container = calEl("yearCalendar");
  const year = 2026;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dows = ["月", "火", "水", "木", "金", "土", "日"];
  container.innerHTML = "";

  for (let m = 0; m < 12; m++) {
    let html = `<div class="month-card"><div class="month-name">${m + 1}月</div><div class="days-grid">`;
    dows.forEach(d => html += `<div class="dow">${d}</div>`);
    const firstDayIdx = new Date(year, m, 1).getDay(); 
    let offset = (firstDayIdx === 0) ? 6 : firstDayIdx - 1;
    const lastDate = new Date(year, m + 1, 0).getDate();

    for (let i = 0; i < offset; i++) html += `<div></div>`;
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, m, d);
      const dayOfWeek = dateObj.getDay();
      let cls = "day";
      if (dateStr === todayStr) cls += " day-today";
      if (dayOfWeek === 6) cls += " day-sat";
      else if (dayOfWeek === 0) cls += " day-sun";
      if (HOLIDAYS_2026.includes(dateStr)) cls += " day-holiday";
      if (isAround(dateStr, FULL_MOONS)) cls += " gsd";
      else if (isAround(dateStr, NEW_MOONS)) cls += " nmd";
      html += `<div class="${cls}">${d}</div>`;
    }
    html += `</div></div>`;
    container.innerHTML += html;
  }
}

window.CalendarTab = { renderYearCalendar };
