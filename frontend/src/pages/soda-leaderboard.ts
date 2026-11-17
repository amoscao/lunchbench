import { getSodaLeaderboard, type SodaLeaderboardRow } from '../api'
import { createLeaderboardTabs } from '../components/leaderboard-tabs'
import { escapeHtml } from '../utils/escape-html'
import { newDrinkText, sodaTypeLabel } from '../utils/soda'

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'plain'
}

const ARROW_RIGHT = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
const ARROW_LEFT = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>'

/** Right / left swipe counts, or "New soda to try" when the drink has no data. */
export function swipeCountsHtml(row: { has_data: boolean; right_swipes: number; left_swipes: number; type: SodaLeaderboardRow['type'] }): string {
  if (!row.has_data) return `<span class="soda-new">${newDrinkText(row.type)}</span>`
  return `
    <span class="swipe-counts" aria-label="${row.right_swipes} right swipes, ${row.left_swipes} left swipes">
      <span class="swipe-count swipe-count-right">${ARROW_RIGHT}${row.right_swipes}</span>
      <span class="swipe-count swipe-count-left">${ARROW_LEFT}${row.left_swipes}</span>
    </span>
  `
}

export function sodaThumbHtml(imageUrl: string | null, name: string): string {
  return imageUrl
    ? `<img class="soda-thumb" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />`
    : `<div class="soda-thumb soda-thumb-empty">${escapeHtml(name.charAt(0))}</div>`
}

export function renderSodaLeaderboard(container: HTMLElement, navigate: (p: string) => void): void {
  const content = document.createElement('div')
  content.className = 'page-content'
  container.appendChild(content)

  content.innerHTML = `
    <h1 class="page-heading">Soda Leaderboard</h1>
    <table class="leaderboard-table soda-table">
      <thead>
        <tr>
          <th class="col-rank">Rank</th>
          <th class="col-name">Drink</th>
          <th class="col-type">Type</th>
          <th class="col-swipes">Swipes</th>
        </tr>
      </thead>
      <tbody id="soda-lb-body">
        ${Array.from({ length: 5 }, () => '<tr><td colspan="4"><div class="skeleton skeleton-row"></div></td></tr>').join('')}
      </tbody>
    </table>
  `
  content.prepend(createLeaderboardTabs('/leaderboard/soda', navigate))
  const tbody = content.querySelector<HTMLElement>('#soda-lb-body')!

  getSodaLeaderboard()
    .then((rows) => {
      if (rows.length === 0) {
        tbody.innerHTML = `
          <tr><td colspan="4">
            <div class="state-center">
              <div class="state-icon">🥤</div>
              <div class="state-title">No drinks yet</div>
            </div>
          </td></tr>
        `
        return
      }
      tbody.innerHTML = rows.map((row) => `
        <tr data-soda-id="${row.id}">
          <td class="col-rank"><span class="rank-badge ${rankBadgeClass(row.rank)}">${row.rank}</span></td>
          <td class="col-name">
            <div class="name-cell">
              ${sodaThumbHtml(row.image_url, row.name)}
              <span class="lunch-name-row">${escapeHtml(row.name)}</span>
            </div>
          </td>
          <td class="col-type"><span class="soda-tag soda-tag-${row.type}">${sodaTypeLabel(row.type)}</span></td>
          <td class="col-swipes">${swipeCountsHtml(row)}</td>
        </tr>
      `).join('')
    })
    .catch(() => {
      tbody.innerHTML = `
        <tr><td colspan="4">
          <div class="state-center">
            <div class="error-icon-wrap">⚠</div>
            <div class="state-title">Something went wrong</div>
          </div>
        </td></tr>
      `
      const btn = document.createElement('button')
      btn.className = 'btn btn-secondary'
      btn.textContent = 'Retry'
      btn.addEventListener('click', () => {
        container.innerHTML = ''
        renderSodaLeaderboard(container, navigate)
      })
      tbody.querySelector('.state-center')?.appendChild(btn)
    })
}
