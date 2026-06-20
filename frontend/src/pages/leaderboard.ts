import { getLeaderboard, type LeaderboardLunch } from '../api'
import { isVeganMode } from '../vegan-mode'
import { animateCountUp } from '../utils/count-up'

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'plain'
}

function renderSkeletonRows(): string {
  return Array.from({ length: 5 }, () => `
    <tr><td colspan="6"><div class="skeleton skeleton-row"></div></td></tr>
  `).join('')
}

export function renderLeaderboard(container: HTMLElement, navigate: (p: string) => void): void {
  const content = document.createElement('div')
  content.className = 'page-content'
  container.appendChild(content)
  const veganOnly = isVeganMode()
  const heading = veganOnly ? 'Vegan Leaderboard' : 'Leaderboard'

  content.innerHTML = `
    <h1 class="page-heading">${heading}</h1>
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th class="col-rank col-help" data-help="Current position on the leaderboard." tabindex="0">Rank</th>
            <th class="col-name col-help" data-help="Lunch dish name." tabindex="0">Lunch</th>
            <th class="col-rating col-help" data-help="Primary rank score used for ordering. Gray subtext shows raw Glicko-2 rating before uncertainty adjustment." tabindex="0">Rating</th>
            <th class="col-record col-help" data-help="Win-loss-tie totals." data-help-align="right" tabindex="0">Record</th>
            <th class="col-confidence col-help" data-help="Top percent is confidence. Gray RD is rating deviation (uncertainty): lower RD means more reliable rating." tabindex="0">Confidence</th>
            <th class="col-consistency col-help" data-help="Number and bar show how evenly this dish performs. Higher means it wins and loses in a predictable pattern rather than swinging wildly." tabindex="0">Consistency</th>
          </tr>
        </thead>
        <tbody id="lb-body">${renderSkeletonRows()}</tbody>
      </table>
  `

  const tbody = content.querySelector<HTMLElement>('#lb-body')!

  getLeaderboard(veganOnly)
    .then((lunches) => {
      if (lunches.length === 0) {
        tbody.innerHTML = `
          <tr><td colspan="6">
            <div class="state-center">
              <div class="state-icon">🏆</div>
              <div class="state-title">No lunches ranked yet</div>
              <div class="state-desc">Add some lunches and start voting!</div>
            </div>
          </td></tr>
        `
        const btn = document.createElement('button')
        btn.className = 'btn btn-primary'
        btn.textContent = 'Add a Lunch'
        btn.style.margin = '0 auto'
        btn.addEventListener('click', () => navigate('/add'))
        tbody.querySelector('.state-center')?.appendChild(btn)
        return
      }

      tbody.innerHTML = ''
      for (const lunch of lunches) {
        const row = document.createElement('tr')
        row.style.cursor = 'pointer'
        row.addEventListener('click', () => navigate(`/lunch/${lunch.id}`))

        const rankTd = document.createElement('td')
        rankTd.className = 'col-rank'
        rankTd.innerHTML = `<span class="rank-badge ${rankBadgeClass(lunch.rank)}">${lunch.rank}</span>`
        row.appendChild(rankTd)

        const nameTd = document.createElement('td')
        nameTd.className = 'col-name'
        nameTd.innerHTML = `
          <div class="name-cell">
            <div>
              <div class="lunch-name-row"><span>${lunch.name}</span>${lunch.is_vegan === 1 ? '<span class="vegan-badge">🌿</span>' : ''}</div>
              ${lunch.description ? `<div class="leaderboard-subtitle">${lunch.description}</div>` : ''}
            </div>
          </div>
        `
        row.appendChild(nameTd)

        const ratingTd = document.createElement('td')
        ratingTd.className = 'col-rating'
        const rating = Math.round(lunch.conservative_rating)
        ratingTd.innerHTML = `<span class="rating-value" data-raw="${rating}">${rating}</span>`
        row.appendChild(ratingTd)

        const recordTd = document.createElement('td')
        recordTd.className = 'col-record'
        recordTd.innerHTML = `
          <span class="wins-text">${lunch.wins}W</span>
          <span class="losses-text"> ${lunch.losses}L</span>
          <span> ${lunch.ties}T</span>
        `
        row.appendChild(recordTd)

        const confTd = document.createElement('td')
        confTd.className = 'leaderboard-cell col-confidence'
        confTd.innerHTML = `
          <div class="confidence-pct">${lunch.confidence}%</div>
          <div class="confidence-rd">RD ${Math.round(lunch.glicko_rd)}</div>
        `
        row.appendChild(confTd)

        const band = lunch.consistency_band
        const consistencyTd = document.createElement('td')
        consistencyTd.className = 'leaderboard-cell col-consistency'

        if (lunch.consistency === null) {
          consistencyTd.innerHTML = `<span class="consistency-empty">—</span>`
        } else {
          const pct = Math.max(0, Math.min(100, lunch.consistency)).toFixed(1)
          consistencyTd.innerHTML = `
            <div class="consistency-row">
              <span class="consistency-num consistency-${band}">${Math.round(lunch.consistency)}</span>
              <div class="consistency-bar-track">
                <div class="consistency-bar-fill consistency-fill-${band}" style="width:${pct}%"></div>
              </div>
            </div>
          `
        }
        row.appendChild(consistencyTd)

        tbody.appendChild(row)
      }

      const table = content.querySelector<HTMLElement>('.leaderboard-table')
      table?.querySelectorAll<HTMLElement>('.col-rating .rating-value').forEach((el) => {
        const raw = Number(el.dataset.raw)
        if (!isNaN(raw)) animateCountUp(el, raw, (v) => String(v))
      })
    })
    .catch(() => {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="state-center">
            <div class="error-icon-wrap">⚠</div>
            <div class="state-title">Something went wrong</div>
            <div class="state-desc">Could not load the leaderboard.</div>
          </div>
        </td></tr>
      `
      const btn = document.createElement('button')
      btn.className = 'btn btn-secondary'
      btn.textContent = 'Retry'
      btn.style.margin = '16px auto 0'
      btn.addEventListener('click', () => {
        container.innerHTML = ''
        renderLeaderboard(container, navigate)
      })
      tbody.querySelector('.state-center')?.appendChild(btn)
    })
}
