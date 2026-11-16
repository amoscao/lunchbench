import { type LeaderboardPage } from '../api'
import { escapeHtml } from './escape-html'

/** Opens a print window with the lunch leaderboard. Shared by /admin and /chris. */
export async function exportLeaderboardPDF(): Promise<void> {
  const res = await fetch('/api/lunches/leaderboard')
  if (!res.ok) throw new Error('Failed to load leaderboard')
  const page: LeaderboardPage = await res.json()
  // Paula legacy lunches are left out; ranks are renumbered over what remains.
  const lunches = page.lunches
    .filter((lunch) => lunch.is_legacy !== 1)
    .map((lunch, i) => ({ ...lunch, rank: i + 1 }))

  const dateString = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const count = lunches.length
  const tableRows = lunches.map((lunch) => {
    const rankClass = lunch.rank <= 3 ? ` rank-${lunch.rank}` : ''
    const veganDot = lunch.is_vegan === 1 ? '<span class="vegan-dot"></span>' : ''
    const description = lunch.description
      ? `<div class="dish-desc">${escapeHtml(lunch.description)}</div>`
      : ''
    const confidenceClass = lunch.confidence >= 75
      ? 'conf-high'
      : lunch.confidence >= 50
        ? 'conf-mid'
        : 'conf-low'

    return `
      <tr>
        <td class="col-rank"><span class="rank-num${rankClass}">${lunch.rank}</span></td>
        <td>
          <div class="dish-name">${escapeHtml(lunch.name)}${veganDot}</div>
          ${description}
        </td>
        <td>
          <div class="rating-val">${Math.round(lunch.conservative_rating)}</div>
          <div class="rating-raw">Raw ${Math.round(lunch.rating)}</div>
        </td>
        <td class="record">
          <span class="w">${lunch.wins}W</span>
          <span class="l">${lunch.losses}L</span>
          <span class="t">${lunch.ties}T</span>
        </td>
        <td>
          <div class="conf-val ${confidenceClass}">${Math.round(lunch.confidence)}%</div>
          <div class="conf-rd">RD ${Math.round(lunch.glicko_rd)}</div>
        </td>
      </tr>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LunchBench Leaderboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      color: #111;
      background: #fff;
      padding: 40px 48px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2.5px solid #e5e7eb;
    }
    .logo-line {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 30px;
      font-weight: 800;
      line-height: 1;
    }
    .logo-text {
      background: linear-gradient(90deg, #10d4a4 0%, #c084fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      font-size: 12px;
      color: #6b7280;
      margin-top: 8px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .export-meta {
      text-align: right;
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.6;
      padding-top: 6px;
    }
    .export-meta strong { color: #6b7280; font-weight: 600; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead th {
      background: #f3f4f6;
      border-bottom: 2px solid #e5e7eb;
      padding: 10px 14px;
      text-align: left;
      font-size: 10.5px;
      font-weight: 700;
      color: #6b7280;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tbody tr { border-bottom: 1px solid #f0f0ee; }
    tbody td { padding: 10px 14px; vertical-align: middle; }
    .col-rank { width: 52px; }
    .rank-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-weight: 800;
      font-size: 13px;
      background: #f3f4f6;
      color: #374151;
    }
    .rank-1 { background: #fef3c7; color: #92400e; }
    .rank-2 { background: #f1f5f9; color: #475569; }
    .rank-3 { background: #fdf4e7; color: #78350f; }
    .dish-name { font-weight: 700; color: #111827; font-size: 13.5px; }
    .dish-desc { font-size: 11px; color: #9ca3af; margin-top: 3px; max-width: 260px; }
    .vegan-dot {
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #16a34a;
      margin-left: 6px;
      vertical-align: middle;
    }
    .rating-val {
      font-weight: 800;
      font-size: 15px;
      color: #0f9e7c;
    }
    .rating-raw { font-size: 10.5px; color: #9ca3af; margin-top: 2px; }
    .record { font-size: 12.5px; }
    .w { color: #059669; font-weight: 700; }
    .l { color: #dc2626; font-weight: 700; }
    .t { color: #6b7280; }
    .conf-val { font-weight: 700; font-size: 13px; }
    .conf-high { color: #059669; }
    .conf-mid  { color: #d97706; }
    .conf-low  { color: #dc2626; }
    .conf-rd { font-size: 10.5px; color: #9ca3af; margin-top: 2px; }
    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 0; }
      @page { margin: 0.5in; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo-line">
        <span>🥪</span>
        <span class="logo-text">LunchBench</span>
      </div>
      <div class="subtitle">Hyperfine Lunch Benchmark</div>
    </div>
    <div class="export-meta">
      <strong>Leaderboard Export</strong><br>
      DATE_STRING<br>
      COUNT dishes ranked
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="col-rank">#</th>
        <th>Dish</th>
        <th>Rating</th>
        <th>Record</th>
        <th>Confidence</th>
      </tr>
    </thead>
    <tbody>
      TABLE_ROWS
    </tbody>
  </table>
  <div class="footer">
    <span>LunchBench · Hyperfine Lunch Benchmark</span>
    <span>COUNT lunches · Glicko-2 rating system</span>
  </div>
</body>
</html>`
    .replace('DATE_STRING', dateString)
    .replaceAll('COUNT', String(count))
    .replace('TABLE_ROWS', tableRows)

  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('Could not open print window')

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.addEventListener('load', () => printWindow.print(), { once: true })
  printWindow.document.close()
}
