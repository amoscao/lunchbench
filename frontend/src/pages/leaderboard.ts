import { getLeaderboard, type LeaderboardLunch } from '../api'
import { isVeganMode } from '../vegan-mode'

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'plain'
}

function renderThumb(lunch: LeaderboardLunch): string {
  if (lunch.image_url) {
    return `<img class="lunch-thumb" src="${lunch.image_url}" alt="${lunch.name}" loading="lazy" />`
  }
  return `<div class="lunch-thumb-placeholder">?</div>`
}

function renderSkeletonRows(): string {
  return Array.from({ length: 5 }, () => `
    <tr><td colspan="5"><div class="skeleton skeleton-row"></div></td></tr>
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
          <th class="col-rank">Rank</th>
          <th class="col-name">Lunch</th>
          <th class="col-rating">Rating</th>
          <th class="col-record">Record</th>
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
          <tr><td colspan="5">
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

      tbody.innerHTML = lunches.map((l) => `
        <tr>
          <td class="col-rank"><span class="rank-badge ${rankBadgeClass(l.rank)}">${l.rank}</span></td>
          <td class="col-name">
            <div class="name-cell">
              ${renderThumb(l)}
              <div>
                <div class="lunch-name-row"><span>${l.name}</span>${l.is_vegan === 1 ? '<span class="vegan-badge">🌿</span>' : ''}</div>
                ${l.description ? `<div class="leaderboard-subtitle">${l.description}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="col-rating">${Math.round(l.rating)}</td>
          <td class="col-record">
            <span class="wins-text">${l.wins}W</span>
            <span class="losses-text"> ${l.losses}L</span>
            <span> ${l.ties}T</span>
          </td>
        </tr>
      `).join('')
    })
    .catch(() => {
      tbody.innerHTML = `
        <tr><td colspan="5">
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
