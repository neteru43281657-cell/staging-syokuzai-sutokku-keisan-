// js/calendar.js
"use strict";

(function() {
  function getMoonType(dateStr) {
    const data = window.CALENDAR_DATA;
    if (!data) return null;
    if (isAroundTarget(dateStr, data.fullMoons)) return "gsd";
    if (isAroundTarget(dateStr, data.newMoons)) return "nmd";
    return null;
  }

  function isAroundTarget(dateStr, targetArray) {
    const date = new Date(dateStr.replace(/-/g, '/'));
    return targetArray.some(target => {
      const tDate = new Date(target.replace(/-/g, '/'));
      const diff = Math.abs(date - tDate) / (1000 * 60 * 60 * 24);
      return diff <= 1.1;
    });
  }

  function render() {
    const container = document.getElementById("yearCalendar");
    if (!container || !window.CALENDAR_DATA) return;

    const data = window.CALENDAR_DATA;

    // ★ 修正: カレンダーデータの年を自動判定
    //   CALENDAR_DATA の fullMoons の最初のエントリから年を取得
    //   データがない場合は現在年にフォールバック
    let year = new Date().getFullYear();
    if (data.fullMoons && data.fullMoons.length > 0) {
      const firstDate = data.fullMoons[0];
      const parsed = parseInt(firstDate.split("-")[0], 10);
      if (parsed) year = parsed;
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dows = ["月", "火", "水", "木", "金", "土", "日"];
    
    container.innerHTML = "";
    container.className = "calendar-grid";

    for (let m = 0; m < 12; m++) {
      let html = `
        <div class="month-card" style="padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: #fff;">
          <div class="month-name" style="font-size: 11px; font-weight: 900; text-align: center; margin-bottom: 4px; color: var(--main); border-bottom: 1.5px solid var(--main-soft);">${m + 1}月</div>
          <div class="days-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0;">
      `;

      dows.forEach((d, idx) => {
        let color = "var(--muted)";
        if (idx === 5) color = "#007bff";
        if (idx === 6) color = "#e74c3b";
        html += `<div style="font-size: 9px; font-weight: 900; text-align: center; color: ${color};">${d}</div>`;
      });

      const firstDayIdx = new Date(year, m, 1).getDay(); 
      let offset = (firstDayIdx === 0) ? 6 : firstDayIdx - 1;
      const lastDate = new Date(year, m + 1, 0).getDate();

      for (let i = 0; i < offset; i++) html += `<div></div>`;

      for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = new Date(year, m, d).getDay();
        const moonType = getMoonType(dateStr);
        
        let color = "var(--text)";
        if (dayOfWeek === 6) color = "#007bff";
        else if (dayOfWeek === 0) color = "#e74c3b";
        
        // 祝日の色を鮮やかなオレンジに
        if (data.holidays.includes(dateStr)) color = "#ff8c00";

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

        let todayBorder = (dateStr === todayStr) ? "outline: 1.5px solid #ff4757; outline-offset: -1.5px; border-radius: 4px; z-index: 5;" : "";

        html += `<div style="font-size: 9px; width: 100%; height: 18px; display: flex; align-items: center; justify-content: center; font-weight: 800; position: relative; ${bgStyle} ${todayBorder} color: ${color};">${d}</div>`;
      }
      html += `</div></div>`;
      container.innerHTML += html;
    }
  }

  window.CalendarTab = { renderYearCalendar: render };
})();
