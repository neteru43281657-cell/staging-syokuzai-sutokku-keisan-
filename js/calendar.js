function renderYearCalendar() {
  const container = calEl("yearCalendar");
  if (!container) return;

  const year = 2026;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dows = ["月", "火", "水", "木", "金", "土", "日"];
  container.innerHTML = "";

  // 常に3列構成にする
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "8px";

  for (let m = 0; m < 12; m++) {
    let html = `
      <div class="month-card" style="padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
        <div class="month-name" style="font-size: 12px; font-weight: 900; text-align: center; margin-bottom: 6px; color: var(--main); border-bottom: 1.5px solid var(--main-soft); padding-bottom: 2px;">${m + 1}月</div>
        <div class="days-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px 0;">
    `;

    dows.forEach((d, idx) => {
      let color = "var(--muted)";
      if (idx === 5) color = "#007bff";
      if (idx === 6) color = "#e74c3c";
      html += `<div style="font-size: 8px; font-weight: 900; text-align: center; color: ${color}; transform: scale(0.85);">${d}</div>`;
    });

    const firstDayIdx = new Date(year, m, 1).getDay(); 
    let offset = (firstDayIdx === 0) ? 6 : firstDayIdx - 1;
    const lastDate = new Date(year, m + 1, 0).getDate();

    for (let i = 0; i < offset; i++) html += `<div></div>`;

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, m, d);
      const dayOfWeek = dateObj.getDay();
      
      let inlineStyle = "font-size: 9px; width: 100%; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: 800; position: relative; z-index: 1;";
      
      // 今日の強調
      if (dateStr === todayStr) {
        inlineStyle += "outline: 1.5px solid #ff4757; outline-offset: -1.5px; border-radius: 4px; z-index: 2;";
      }

      // 文字色
      let color = "var(--text)";
      if (dayOfWeek === 6) color = "#007bff";
      if (dayOfWeek === 0 || HOLIDAYS_2026.includes(dateStr)) color = "#e74c3c";
      
      // GSD/NMD 連結判定ロジック
      let bgStyle = "";
      const isGSD = isAround(dateStr, FULL_MOONS);
      const isNMD = isAround(dateStr, NEW_MOONS);

      if (isGSD || isNMD) {
        const typeCls = isGSD ? "#add8e6" : "#000080";
        const textColor = isGSD ? "#000" : "#fff";
        color = textColor;

        // 連結のための角丸計算
        const prevStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`;
        const nextStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
        const hasPrev = isAround(prevStr, isGSD ? FULL_MOONS : NEW_MOONS) && d > 1;
        const hasNext = isAround(nextStr, isGSD ? FULL_MOONS : NEW_MOONS) && d < lastDate;

        let radius = "4px";
        if (hasPrev && hasNext) radius = "0"; // 中間
        else if (hasPrev) radius = "0 10px 10px 0"; // 右端
        else if (hasNext) radius = "10px 0 0 10px"; // 左端
        else radius = "10px"; // 独立（基本ないはずですが）

        bgStyle = `background: ${typeCls}; border-radius: ${radius}; margin: 1px 0;`;
      }
      
      html += `<div class="day" style="${inlineStyle} ${bgStyle} color: ${color};">${d}</div>`;
    }
    html += `</div></div>`;
    container.innerHTML += html;
  }
}
