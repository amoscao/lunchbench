import { ApiError, getSodaOrder, revokeSession, verifyAdminToken, type SodaOrder } from '../api'
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  PURCHASER_SESSION_KEY,
  setStoredSessionToken,
} from '../utils/auth-storage'
import { escapeHtml } from '../utils/escape-html'
import { exportLeaderboardPDF } from '../utils/lunch-pdf'
import { formatWeekOf, orderTag } from '../utils/soda'
import { sodaThumbHtml, swipeCountsHtml } from './soda-leaderboard'

/** Purchaser page: lunch PDF export and this week's frozen soda order list. */
export function renderChris(container: HTMLElement): () => void {
  const content = document.createElement('div')
  content.className = 'page-content chris-page'
  container.appendChild(content)
  let destroyed = false

  function renderLogin(message?: string): void {
    content.innerHTML = `
      <h1 class="page-heading">Purchaser Login</h1>
      <form class="chris-login">
        <div class="form-group">
          <label class="form-label" for="chris-password">Password</label>
          <input class="form-input" type="password" id="chris-password" autocomplete="current-password" />
        </div>
        <div class="alert alert-error chris-login-error" ${message ? '' : 'hidden'}>${escapeHtml(message ?? '')}</div>
        <button type="submit" class="btn btn-primary btn-full chris-login-btn">Log in</button>
      </form>
    `
    const form = content.querySelector<HTMLFormElement>('.chris-login')!
    const input = content.querySelector<HTMLInputElement>('#chris-password')!
    const error = content.querySelector<HTMLElement>('.chris-login-error')!
    const button = content.querySelector<HTMLButtonElement>('.chris-login-btn')!
    input.focus()

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const password = input.value
      if (!password) return
      button.disabled = true
      error.hidden = true
      try {
        const token = await verifyAdminToken(password)
        if (destroyed) return
        setStoredSessionToken(token, PURCHASER_SESSION_KEY)
        await loadOrder(token, true)
      } catch (e: unknown) {
        if (destroyed) return
        error.textContent = (e as Error).message || 'Login failed'
        error.hidden = false
        button.disabled = false
      }
    })
  }

  function renderOrder(order: SodaOrder, token: string): void {
    content.innerHTML = `
      <div class="chris-header">
        <div class="chris-title">
          <h1 class="page-heading">This Week's Order</h1>
          <span class="chris-week">${escapeHtml(formatWeekOf(order.week_start))}</span>
        </div>
        <div class="chris-actions">
          <button type="button" class="btn btn-secondary chris-export">Export lunch PDF</button>
          <button type="button" class="btn btn-secondary chris-logout">Log out</button>
        </div>
      </div>
      <div class="alert alert-error chris-alert" hidden></div>
      <table class="leaderboard-table order-table">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th class="col-name">Drink</th>
            <th class="col-type">Type</th>
            <th class="col-swipes">Swipes</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map((item) => {
            const tag = orderTag(item)
            return `
              <tr class="order-row order-row-${item.slot}" data-soda-id="${item.soda_id}">
                <td class="col-rank"><span class="order-rank">${item.rank}</span></td>
                <td class="col-name">
                  <div class="name-cell">
                    ${sodaThumbHtml(item.image_url, item.name)}
                    <span class="lunch-name-row">${escapeHtml(item.name)}</span>
                  </div>
                </td>
                <td class="col-type"><span class="soda-tag soda-tag-${tag.toLowerCase()}">${tag}</span></td>
                <td class="col-swipes">${swipeCountsHtml(item)}</td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `

    const exportBtn = content.querySelector<HTMLButtonElement>('.chris-export')!
    const alert = content.querySelector<HTMLElement>('.chris-alert')!
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true
      alert.hidden = true
      try {
        await exportLeaderboardPDF()
      } catch {
        alert.textContent = 'Export failed'
        alert.hidden = false
      } finally {
        exportBtn.disabled = false
      }
    })
    content.querySelector('.chris-logout')!.addEventListener('click', () => {
      clearStoredSessionToken(PURCHASER_SESSION_KEY)
      void revokeSession(token).catch(() => undefined)
      renderLogin()
    })
  }

  async function loadOrder(token: string, afterLogin = false): Promise<void> {
    if (!content.querySelector('.order-table')) {
      content.innerHTML = '<div class="skeleton" style="height:420px;border-radius:var(--radius-md)"></div>'
    }
    try {
      const order = await getSodaOrder(token)
      if (destroyed) return
      renderOrder(order, token)
    } catch (e: unknown) {
      if (destroyed) return
      if (e instanceof ApiError && e.status === 401) {
        clearStoredSessionToken(PURCHASER_SESSION_KEY)
        // A lunch password signs in but is not a purchaser; an expired session just asks again.
        renderLogin(afterLogin ? 'Not authorized' : undefined)
        return
      }
      content.innerHTML = `
        <div class="state-center">
          <div class="error-icon-wrap">⚠</div>
          <div class="state-title">Something went wrong</div>
        </div>
      `
      const retry = document.createElement('button')
      retry.className = 'btn btn-secondary'
      retry.textContent = 'Retry'
      retry.addEventListener('click', () => void loadOrder(token))
      content.querySelector('.state-center')!.appendChild(retry)
    }
  }

  const stored = getStoredSessionToken(PURCHASER_SESSION_KEY)
  if (stored) void loadOrder(stored)
  else renderLogin()

  return () => {
    destroyed = true
  }
}
