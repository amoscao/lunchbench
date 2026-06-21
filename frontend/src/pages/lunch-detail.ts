import { getLunch, type LunchDetail } from '../api'
import { animateCountUp } from '../utils/count-up'
import { escapeHtml } from '../utils/escape-html'

function metricTile(
  label: string,
  value: string,
  sub?: string,
  raw?: number,
  format: 'int' | 'pct' | 'pct1' = 'int',
  valueClass = '',
): HTMLElement {
  const tile = document.createElement('div')
  tile.className = 'metric-tile'
  const dataAttrs = raw === undefined ? '' : ` data-animate="${raw}" data-format="${format}"`
  tile.innerHTML = `
    <div class="metric-label">${label}</div>
    <div class="metric-value${valueClass ? ' ' + valueClass : ''}"${dataAttrs}>${value}</div>
    ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
  `
  return tile
}

function confidenceClass(pct: number): string {
  if (pct >= 75) return 'conf-high'
  if (pct >= 50) return 'conf-mid'
  return 'conf-low'
}

function bandLabel(band: string | null): string {
  switch (band) {
    case 'very-steady': return 'Very Steady'
    case 'steady':      return 'Steady'
    case 'mixed':       return 'Mixed'
    case 'high-swing':  return 'High Swing'
    default:            return '—'
  }
}

function bandColor(band: string | null): string {
  switch (band) {
    case 'very-steady': return 'hsl(152, 60%, 45%)'
    case 'steady':      return 'hsl(168, 88%, 52%)'
    case 'mixed':       return 'hsl(40, 95%, 52%)'
    case 'high-swing':  return 'hsl(0, 80%, 52%)'
    default:            return 'var(--text-muted)'
  }
}

function bandFillClass(band: string | null): string {
  switch (band) {
    case 'very-steady': return 'consistency-fill-very-steady'
    case 'steady':      return 'consistency-fill-steady'
    case 'mixed':       return 'consistency-fill-mixed'
    case 'high-swing':  return 'consistency-fill-high-swing'
    default:            return ''
  }
}

function consistencySection(consistency: number | null, band: string | null): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'detail-consistency detail-enter detail-enter-3'

  if (consistency === null) {
    wrap.innerHTML = `<div class="detail-consistency-header">
      <span class="detail-consistency-label">Consistency</span>
      <span class="consistency-empty">—</span>
    </div>`
    return wrap
  }

  const pct = Math.max(0, Math.min(100, Math.round(consistency)))
  const color = bandColor(band)
  const fillClass = bandFillClass(band)

  wrap.innerHTML = `
    <div class="detail-consistency-header">
      <span class="detail-consistency-label">Consistency</span>
      <span class="detail-consistency-band">
        <span class="consistency-dot" style="background:${color}"></span>
        <span style="color:${color}">${bandLabel(band)}</span>
      </span>
    </div>
    <div class="consistency-row">
      <span class="consistency-num">${pct}</span>
      <div class="consistency-bar-track">
        <div class="consistency-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
    </div>
  `
  return wrap
}

function wltSection(wins: number, losses: number, ties: number): HTMLElement {
  const total = wins + losses + ties
  const wPct = total > 0 ? ((wins / total) * 100).toFixed(1) : '0'
  const lPct = total > 0 ? ((losses / total) * 100).toFixed(1) : '0'
  const tPct = total > 0 ? ((ties / total) * 100).toFixed(1) : '0'

  const wrap = document.createElement('div')
  wrap.className = 'wlt-bar-wrap detail-enter detail-enter-4'
  wrap.innerHTML = `
    <div class="wlt-chips">
      <span class="wlt-chip wlt-chip-win">${wins}W</span>
      <span class="wlt-chip wlt-chip-tie">${ties}T</span>
      <span class="wlt-chip wlt-chip-loss">${losses}L</span>
    </div>
    <div class="wlt-bar">
      <div class="wlt-seg wlt-win"  style="width:${wPct}%" title="Wins: ${wins}"></div>
      <div class="wlt-seg wlt-tie"  style="width:${tPct}%" title="Ties: ${ties}"></div>
      <div class="wlt-seg wlt-loss" style="width:${lPct}%" title="Losses: ${losses}"></div>
    </div>
  `
  return wrap
}

function renderDetail(content: HTMLElement, lunch: LunchDetail, navigate: (p: string) => void): void {
  content.innerHTML = ''

  // Back button
  const back = document.createElement('button')
  back.className = 'btn btn-secondary detail-back detail-enter detail-enter-1'
  back.textContent = '← Leaderboard'
  back.addEventListener('click', () => navigate('/leaderboard'))
  content.appendChild(back)

  // Hero
  const hero = document.createElement('div')
  hero.className = 'detail-hero detail-enter detail-enter-1'
  const img = lunch.image_url
    ? `<img class="detail-image" src="${escapeHtml(lunch.image_url)}" alt="${escapeHtml(lunch.name)}" />`
    : `<div class="detail-image-placeholder"><span>?</span></div>`
  const veganBadge = lunch.is_vegan === 1 ? '<span class="vegan-badge">🌿 Vegan</span>' : ''
  hero.innerHTML = `
    ${img}
    <div class="detail-hero-info">
      <h1 class="detail-name">${escapeHtml(lunch.name)}${veganBadge}</h1>
      ${lunch.description ? `<p class="detail-description">${escapeHtml(lunch.description)}</p>` : ''}
    </div>
  `
  content.appendChild(hero)

  // Metric tile grid
  const grid = document.createElement('div')
  grid.className = 'metric-row detail-enter detail-enter-2'

  const totalVotes = lunch.wins + lunch.losses + lunch.ties
  const winRatePct = (lunch.win_rate * 100).toFixed(1)

  grid.appendChild(metricTile(
    'Lunch Score',
    String(Math.round(lunch.conservative_rating)),
    `raw ${Math.round(lunch.rating)}`,
    Math.round(lunch.conservative_rating),
    'int',
    'accent',
  ))
  grid.appendChild(metricTile(
    'Confidence',
    `${lunch.confidence}%`,
    `RD ${Math.round(lunch.glicko_rd)}`,
    lunch.confidence,
    'pct',
    confidenceClass(lunch.confidence),
  ))
  grid.appendChild(metricTile(
    'Win Rate',
    `${winRatePct}%`,
    undefined,
    Math.round(lunch.win_rate * 1000),
    'pct1',
  ))
  grid.appendChild(metricTile('Total Votes', String(totalVotes), undefined, totalVotes, 'int'))
  grid.appendChild(metricTile('Wins',   String(lunch.wins),   undefined, lunch.wins,   'int', 'win'))
  grid.appendChild(metricTile('Losses', String(lunch.losses), undefined, lunch.losses, 'int', 'loss'))
  grid.appendChild(metricTile('Ties',   String(lunch.ties),   undefined, lunch.ties,   'int'))

  content.appendChild(grid)

  // Animate count-ups
  grid.querySelectorAll<HTMLElement>('[data-animate]').forEach((el) => {
    const raw = Number(el.dataset.animate)
    if (Number.isNaN(raw)) return
    const fmt = el.dataset.format ?? 'int'
    animateCountUp(el, raw, (v) => {
      if (fmt === 'pct') return `${Math.round(v)}%`
      if (fmt === 'pct1') return `${(v / 10).toFixed(1)}%`
      return String(Math.round(v))
    })
  })

  // Consistency
  content.appendChild(consistencySection(lunch.consistency, lunch.consistency_band))

  // W/L/T
  content.appendChild(wltSection(lunch.wins, lunch.losses, lunch.ties))
}

export function renderLunchDetail(
  container: HTMLElement,
  navigate: (p: string) => void,
  id: number
): void {
  container.innerHTML = ''
  const content = document.createElement('div')
  content.className = 'page-content'
  container.appendChild(content)

  content.innerHTML = '<div class="state-center"><div class="state-desc">Loading…</div></div>'

  getLunch(id)
    .then((lunch) => renderDetail(content, lunch, navigate))
    .catch(() => {
      content.innerHTML = '<div class="state-center"><div class="state-title">Not found</div></div>'
    })
}
