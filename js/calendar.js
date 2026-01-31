function renderYearCalendar() {
  const container = calEl("yearCalendar");
  if (!container) return; // コンテナがない場合は処理しない

  const year = 2026;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dows = ["月", "火", "水", "木", "金", "土", "日"];
  container.innerHTML = "";

  // PCでは3列並ぶように、スマホでも一覧しやすいように調整
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  if (window.innerWidth < 400) {
    container.style.gridTemplateColumns = "repeat(2, 1fr)"; // 非常に狭い画面では2列
  }

  for (let m = 0; m < 12; m++) {
    let html = `
      <div class="month-card" style="padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: #fff;">
        <div class="month-name" style="font-size: 13px; font-weight: 900; text-align: center; margin-bottom: 4px; color: var(--main); border-bottom: 1.5px solid var(--main-soft);">${m + 1}月</div>
        <div class="days-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px;">
    `;

    // 曜日の見出し
    dows.forEach((d, idx) => {
      let color = "var(--muted)";
      if (idx === 5) color = "#007bff"; // 土
      if (idx === 6) color = "#e74c3c"; // 日
      html += `<div style="font-size: 8px; font-weight: 900; text-align: center; color: ${color}; transform: scale(0.9);">${d}</div>`;
    });

    const firstDayIdx = new Date(year, m, 1).getDay(); 
    let offset = (firstDayIdx === 0) ? 6 : firstDayIdx - 1;
    const lastDate = new Date(year, m + 1, 0).getDate();

    // 空白埋め
    for (let i = 0; i < offset; i++) html += `<div></div>`;

    // 日付
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, m, d);
      const dayOfWeek = dateObj.getDay();
      
      let cls = "day";
      let inlineStyle = "font-size: 9px; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; font-weight: 800; border-radius: 4px; position: relative;";
      
      // 今日のマーカー（より目立たなく、かつ分かるように）
      if (dateStr === todayStr) {
        inlineStyle += "outline: 1.5px solid #ff4757; outline-offset: -1.5px;";
      }

      // 文字色設定
      let color = "var(--text)";
      if (dayOfWeek === 6) color = "#007bff";
      if (dayOfWeek === 0 || HOLIDAYS_2026.includes(dateStr)) color = "#e74c3c";
      inlineStyle += `color: ${color};`;

      // GSD / 新月の背景
      let bg = "";
      if (isAround(dateStr, FULL_MOONS)) {
        bg = "background: #add8e6; color: #000; border-radius: 50%;"; // 丸型に
      } else if (isAround(dateStr, NEW_MOONS)) {
        bg = "background: #000080; color: #fff; border-radius: 50%;"; // 丸型に
      }
      
      html += `<div class="${cls}" style="${inlineStyle} ${bg}">${d}</div>`;
    }
    html += `</div></div>`;
    container.innerHTML += html;
  }
}
