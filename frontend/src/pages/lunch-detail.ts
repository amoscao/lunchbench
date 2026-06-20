import { getLunch, type LunchDetail } from '../api'

function statCard(label: string, value: string, sub?: string): HTMLElement {
  const card = document.createElement('div')
  card.className = 'stat-card'
  card.innerHTML = `
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  `
  return card
}

function wltBar(wins: number, losses: number, ties: number): HTMLElement {
  const total = wins + losses + ties
  const wPct = total > 0 ? (wins / total * 100).toFixed(1) : '0'
  const lPct = total > 0 ? (losses / total * 100).toFixed(1) : '0'
  const tPct = total > 0 ? (ties / total * 100).toFixed(1) : '0'
  const bar = document.createElement('div')
  bar.className = 'wlt-bar-wrap'
  bar.innerHTML = `
    <div class="wlt-bar">
      <div class="wlt-seg wlt-win"  style="width:${wPct}%" title="Wins: ${wins}"></div>
      <div class="wlt-seg wlt-tie"  style="width:${tPct}%" title="Ties: ${ties}"></div>
      <div class="wlt-seg wlt-loss" style="width:${lPct}%" title="Losses: ${losses}"></div>
    </div>
    <div class="wlt-legend">
      <span class="wlt-win-label">${wins}W</span>
      <span class="wlt-tie-label">${ties}T</span>
      <span class="wlt-loss-label">${losses}L</span>
    </div>
  `
  return bar
}

function bandLabel(band: string | null): string {
  switch (band) {
    case 'very-steady':
      return 'Very Steady'
    case 'steady':
      return 'Steady'
    case 'mixed':
      return 'Mixed'
    case 'high-swing':
      return 'High Swing'
    default:
      return '—'
  }
}

function renderDetail(content: HTMLElement, lunch: LunchDetail, navigate: (p: string) => void): void {
  content.innerHTML = ''

  // Back button
  const back = document.createElement('button')
  back.className = 'btn btn-secondary detail-back'
  back.textContent = '← Leaderboard'
  back.addEventListener('click', () => navigate('/leaderboard'))
  content.appendChild(back)

  // Hero
  const hero = document.createElement('div')
  hero.className = 'detail-hero'
  const img = lunch.image_url
    ? `<img class="detail-image" src="${lunch.image_url}" alt="${lunch.name}" />`
    : `<div class="detail-image-placeholder"><span>?</span></div>`
  const veganBadge = lunch.is_vegan === 1 ? '<span class="vegan-badge">🌿 Vegan</span>' : ''
  hero.innerHTML = `
    ${img}
    <div class="detail-hero-info">
      <h1 class="detail-name">${lunch.name}${veganBadge}</h1>
      ${lunch.description ? `<p class="detail-description">${lunch.description}</p>` : ''}
    </div>
  `
  content.appendChild(hero)

  // Stat cards grid
  const grid = document.createElement('div')
  grid.className = 'stat-grid'

  const totalVotes = lunch.wins + lunch.losses + lunch.ties
  const winRatePct = (lunch.win_rate * 100).toFixed(1)
  const consStr = lunch.consistency !== null
    ? `${Math.round(lunch.consistency)} · ${bandLabel(lunch.consistency_band)}`
    : '—'
  const momentumStr = lunch.momentum >= 0 ? `+${lunch.momentum}` : `${lunch.momentum}`

  grid.appendChild(statCard('Rating', String(Math.round(lunch.conservative_rating)), `raw ${Math.round(lunch.rating)}`))
  grid.appendChild(statCard('Confidence', `${lunch.confidence}%`, `RD ${Math.round(lunch.glicko_rd)}`))
  grid.appendChild(statCard('Consistency', consStr))
  grid.appendChild(statCard('Win Rate', `${winRatePct}%`))
  grid.appendChild(statCard('Total Votes', String(totalVotes)))
  grid.appendChild(statCard('Wins', String(lunch.wins)))
  grid.appendChild(statCard('Losses', String(lunch.losses)))
  grid.appendChild(statCard('Ties', String(lunch.ties)))
  grid.appendChild(statCard('Momentum', momentumStr))

  content.appendChild(grid)

  // W/L/T bar
  content.appendChild(wltBar(lunch.wins, lunch.losses, lunch.ties))
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

  // Loading state
  content.innerHTML = '<div class="state-center"><div class="state-desc">Loading…</div></div>'

  getLunch(id)
    .then((lunch) => renderDetail(content, lunch, navigate))
    .catch(() => {
      content.innerHTML = '<div class="state-center"><div class="state-title">Not found</div></div>'
    })
}
