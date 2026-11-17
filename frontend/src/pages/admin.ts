import { getSodaCatalog, type Lunch, type Soda } from '../api'
import { escapeHtml } from '../utils/escape-html'
import { exportLeaderboardPDF } from '../utils/lunch-pdf'

const API_URL = '/api'

type AdminState = {
  lunches: Lunch[]
}

let adminToken: string | null = null

const state: AdminState = {
  lunches: [],
}

function setAdminToken(token: string): void {
  adminToken = token
}

function clearAdminToken(): void {
  adminToken = null
  state.lunches = []
}

window.addEventListener('pagehide', clearAdminToken)
window.addEventListener('beforeunload', clearAdminToken)

export function renderAdmin(container: HTMLElement): () => void {
  container.innerHTML = ''
  const content = document.createElement('div')
  content.className = 'page-content'
  container.appendChild(content)

  if (!adminToken) {
    renderLogin(content)
  } else {
    renderDashboard(content)
  }

  return clearAdminToken
}

function renderLogin(container: HTMLElement): void {
  container.innerHTML = `
    <h1 class="page-heading">Admin Login</h1>
    <div style="max-width:400px">
      <div class="form-group">
        <label class="form-label">Admin Password</label>
        <input class="form-input" type="password" placeholder="Enter admin password" id="admin-pw" />
      </div>
      <div id="login-error" style="display:none" class="alert alert-error"></div>
      <button class="btn btn-primary btn-full" id="login-btn">Login</button>
    </div>
  `

  const pwInput = container.querySelector<HTMLInputElement>('#admin-pw')!
  const loginBtn = container.querySelector<HTMLButtonElement>('#login-btn')!
  const errorEl = container.querySelector<HTMLElement>('#login-error')!

  async function doLogin(): Promise<void> {
    const pw = pwInput.value
    if (!pw) return
    loginBtn.disabled = true
    loginBtn.textContent = 'Logging in...'
    errorEl.style.display = 'none'

    try {
      const res = await fetch(`${API_URL}/admin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error ?? 'Login failed')
      }
      const { token } = await res.json()
      setAdminToken(token)
      container.innerHTML = ''
      renderDashboard(container)
    } catch (e: unknown) {
      errorEl.textContent = (e as Error).message ?? 'Login failed'
      errorEl.style.display = 'block'
    } finally {
      loginBtn.disabled = false
      loginBtn.textContent = 'Login'
    }
  }

  loginBtn.addEventListener('click', doLogin)
  pwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin()
  })
}

async function fetchAdminLunches(): Promise<Lunch[]> {
  const res = await fetch(`${API_URL}/admin/lunches`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (res.status === 401) {
    clearAdminToken()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to load lunches')
  const data = await res.json()
  return data.lunches
}

async function fetchAdminStats(): Promise<{ votes_24h: number; votes_7d: number; votes_30d: number }> {
  const res = await fetch(`${API_URL}/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (res.status === 401) {
    clearAdminToken()
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json()
}

type UnknownScanGroup = {
  code: string
  formats: string[]
  scans: number
  voters: number
  first_seen: string
  last_seen: string
  picks: { soda_id: number; name: string; count: number }[]
  mapped_soda_id: number | null
  mapped_name: string | null
  mapped_source: 'seed' | 'voter' | 'admin' | null
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, ...init.headers },
  })
  if (res.status === 401) {
    clearAdminToken()
    throw new Error('Session expired')
  }
  return res
}

async function fetchUnknownScans(): Promise<UnknownScanGroup[]> {
  const res = await adminFetch('/admin/soda/unknown-scans')
  if (!res.ok) throw new Error('Failed to load unknown scans')
  return (await res.json() as { codes: UnknownScanGroup[] }).codes
}

type BannedDrink = { id: number; name: string; hates: number; likes: number }

async function fetchBannedDrinks(): Promise<BannedDrink[]> {
  const res = await adminFetch('/admin/soda/banned')
  if (!res.ok) throw new Error('Failed to load banned drinks')
  return (await res.json() as { banned: BannedDrink[] }).banned
}

/** "2026-11-16 14:03:22" (UTC, from SQLite) -> "Nov 16, 9:03 AM" in the viewer's zone. */
function formatSeen(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

async function revokeAdminSession(token: string | null): Promise<void> {
  if (!token) return
  await fetch(`${API_URL}/admin/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

function renderDashboard(container: HTMLElement): void {
  let activeTab: 'lunches' | 'stats' | 'scans' | 'banned' = 'lunches'

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h1 class="page-heading" style="margin:0">Admin Dashboard</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-secondary" id="export-pdf-btn">Export PDF</button>
        <button class="btn btn-secondary" id="logout-btn">Logout</button>
      </div>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:0">
      <button class="admin-tab admin-tab-active" id="tab-lunches" style="padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--accent);cursor:pointer;margin-bottom:-1px">Lunches</button>
      <button class="admin-tab" id="tab-stats" style="padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;margin-bottom:-1px">Stats</button>
      <button class="admin-tab" id="tab-scans" style="padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;margin-bottom:-1px">Unknown scans</button>
      <button class="admin-tab" id="tab-banned" style="padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;margin-bottom:-1px">Banned drinks</button>
    </div>
    <div id="admin-alert" style="display:none" class="alert"></div>
    <div id="admin-tab-content">
      <div id="admin-table-wrap">
        <div class="skeleton" style="height:200px;border-radius:var(--radius-md)"></div>
      </div>
    </div>
  `

  const tabLunches = container.querySelector<HTMLButtonElement>('#tab-lunches')!
  const tabStats = container.querySelector<HTMLButtonElement>('#tab-stats')!
  const tabScans = container.querySelector<HTMLButtonElement>('#tab-scans')!
  const tabBanned = container.querySelector<HTMLButtonElement>('#tab-banned')!
  const tabContent = container.querySelector<HTMLElement>('#admin-tab-content')!

  function setTab(tab: 'lunches' | 'stats' | 'scans' | 'banned'): void {
    activeTab = tab
    const accentStyle = `padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--accent);cursor:pointer;margin-bottom:-1px`
    const inactiveStyle = `padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;margin-bottom:-1px`
    tabLunches.style.cssText = tab === 'lunches' ? accentStyle : inactiveStyle
    tabStats.style.cssText   = tab === 'stats'   ? accentStyle : inactiveStyle
    tabScans.style.cssText   = tab === 'scans'   ? accentStyle : inactiveStyle
    tabBanned.style.cssText  = tab === 'banned'  ? accentStyle : inactiveStyle
    if (tab === 'lunches') {
      tabContent.innerHTML = `<div id="admin-table-wrap"><div class="skeleton" style="height:200px;border-radius:var(--radius-md)"></div></div>`
      loadTable()
    } else if (tab === 'scans') {
      void loadScans()
    } else if (tab === 'banned') {
      void loadBanned()
    } else {
      loadStats()
    }
  }

  tabLunches.addEventListener('click', () => setTab('lunches'))
  tabStats.addEventListener('click',   () => setTab('stats'))
  tabScans.addEventListener('click',   () => setTab('scans'))
  tabBanned.addEventListener('click',  () => setTab('banned'))

  const exportPdfBtn = container.querySelector<HTMLButtonElement>('#export-pdf-btn')!
  exportPdfBtn.addEventListener('click', async () => {
    exportPdfBtn.disabled = true
    exportPdfBtn.textContent = 'Exporting…'
    try {
      await exportLeaderboardPDF()
    } catch {
      showAlert('Export failed', 'error')
    } finally {
      exportPdfBtn.disabled = false
      exportPdfBtn.textContent = 'Export PDF'
    }
  })

  container.querySelector('#logout-btn')!.addEventListener('click', () => {
    const token = adminToken
    clearAdminToken()
    container.innerHTML = ''
    renderLogin(container)
    void revokeAdminSession(token).catch(() => undefined)
  })

  const alertEl = container.querySelector<HTMLElement>('#admin-alert')!

  function showAlert(msg: string, type: 'success' | 'error'): void {
    alertEl.className = `alert alert-${type}`
    alertEl.textContent = msg
    alertEl.style.display = 'block'
    if (type === 'success') {
      setTimeout(() => {
        alertEl.style.display = 'none'
      }, 3000)
    }
  }

  async function loadTable(): Promise<void> {
    try {
      state.lunches = await fetchAdminLunches()
    } catch (e: unknown) {
      if ((e as Error).message === 'Session expired') {
        container.innerHTML = ''
        renderLogin(container)
        return
      }
      showAlert('Failed to load lunches', 'error')
      return
    }
    renderTable()
  }

  function renderTable(): void {
    const wrap = container.querySelector<HTMLElement>('#admin-table-wrap')!
    wrap.innerHTML = `
      <table class="leaderboard-table" style="font-size:13px">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Description</th>
            <th>Vegan</th>
            <th>Rating</th>
            <th>W/L/T</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.lunches.map((l) => `
            <tr data-id="${l.id}">
              <td>${l.id}</td>
              <td class="admin-name">${escapeHtml(l.name)}</td>
              <td class="admin-desc" style="max-width:200px;white-space:pre-wrap">${escapeHtml(l.description)}</td>
              <td>${l.is_vegan ? 'Yes' : '-'}</td>
              <td>${Math.round(l.rating)}</td>
              <td>${l.wins}/${l.losses}/${l.ties}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" data-action="edit">Edit</button>
                <button class="btn" style="padding:4px 10px;font-size:11px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:var(--radius-sm);cursor:pointer;margin-left:4px" data-action="delete">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `

    wrap.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = (btn as HTMLElement).closest('tr')!
        const id = Number(row.dataset.id)
        const lunch = state.lunches.find((l) => l.id === id)!
        renderEditRow(row, lunch, async (updates) => {
          try {
            const res = await fetch(`${API_URL}/admin/lunches/${id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
              },
              body: JSON.stringify(updates),
            })
            if (res.status === 401) {
              clearAdminToken()
              container.innerHTML = ''
              renderLogin(container)
              return
            }
            if (!res.ok) throw new Error('Update failed')
            showAlert('Updated!', 'success')
            await loadTable()
          } catch {
            showAlert('Update failed', 'error')
          }
        })
      })
    })

    wrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = (btn as HTMLElement).closest('tr')!
        const id = Number(row.dataset.id)
        const lunch = state.lunches.find((l) => l.id === id)!
        if (!window.confirm(`Delete "${lunch.name}"? This will also delete all votes for this lunch.`)) return
        try {
          const res = await fetch(`${API_URL}/admin/lunches/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminToken}` },
          })
          if (res.status === 401) {
            clearAdminToken()
            container.innerHTML = ''
            renderLogin(container)
            return
          }
          if (!res.ok) throw new Error('Delete failed')
          showAlert('Deleted!', 'success')
          await loadTable()
        } catch {
          showAlert('Delete failed', 'error')
        }
      })
    })
  }

  function renderEditRow(
    row: HTMLElement,
    lunch: Lunch,
    onSave: (updates: { name: string; description: string; is_vegan: boolean }) => void
  ): void {
    const originalHTML = row.innerHTML
    row.innerHTML = `
      <td>${lunch.id}</td>
      <td><input class="form-input" style="width:140px;padding:6px 8px" value="${escapeHtml(lunch.name)}" id="edit-name" /></td>
      <td><textarea class="form-input" style="width:160px;padding:6px 8px;font-size:12px;min-height:60px" id="edit-desc">${escapeHtml(lunch.description)}</textarea></td>
      <td><input type="checkbox" id="edit-vegan" ${lunch.is_vegan ? 'checked' : ''} /></td>
      <td>${Math.round(lunch.rating)}</td>
      <td>${lunch.wins}/${lunch.losses}/${lunch.ties}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary" style="padding:4px 10px;font-size:11px" id="save-btn">Save</button>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;margin-left:4px" id="cancel-btn">Cancel</button>
      </td>
    `
    row.querySelector('#save-btn')!.addEventListener('click', () => {
      const name = (row.querySelector('#edit-name') as HTMLInputElement).value
      const description = (row.querySelector('#edit-desc') as HTMLTextAreaElement).value
      const is_vegan = (row.querySelector('#edit-vegan') as HTMLInputElement).checked
      onSave({ name, description, is_vegan })
    })
    row.querySelector('#cancel-btn')!.addEventListener('click', () => {
      row.innerHTML = originalHTML
      renderTable()
    })
  }

  function loadStats(): void {
    tabContent.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:680px">
        <div class="card" style="padding:28px 24px;text-align:center">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px">Last 24 Hours</div>
          <div id="stat-24h" class="skeleton" style="height:48px;border-radius:var(--radius-md);width:80px;margin:0 auto"></div>
        </div>
        <div class="card" style="padding:28px 24px;text-align:center">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px">Last 7 Days</div>
          <div id="stat-7d" class="skeleton" style="height:48px;border-radius:var(--radius-md);width:80px;margin:0 auto"></div>
        </div>
        <div class="card" style="padding:28px 24px;text-align:center">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:12px">Last 30 Days</div>
          <div id="stat-30d" class="skeleton" style="height:48px;border-radius:var(--radius-md);width:80px;margin:0 auto"></div>
        </div>
      </div>
    `

    fetchAdminStats()
      .then(({ votes_24h, votes_7d, votes_30d }) => {
        const fmt = (n: number): string =>
          `<div style="font-size:42px;font-weight:800;color:var(--accent);line-height:1">${n.toLocaleString()}</div><div style="font-size:12px;color:var(--text-secondary);margin-top:6px">votes</div>`
        tabContent.querySelector('#stat-24h')!.outerHTML = `<div id="stat-24h">${fmt(votes_24h)}</div>`
        tabContent.querySelector('#stat-7d')!.outerHTML  = `<div id="stat-7d">${fmt(votes_7d)}</div>`
        tabContent.querySelector('#stat-30d')!.outerHTML = `<div id="stat-30d">${fmt(votes_30d)}</div>`
      })
      .catch((e: unknown) => {
        if ((e as Error).message === 'Session expired') {
          container.innerHTML = ''
          renderLogin(container)
          return
        }
        tabContent.innerHTML = `<div class="alert alert-error">Failed to load stats</div>`
      })
  }

  function sessionExpired(e: unknown): boolean {
    if ((e as Error).message !== 'Session expired') return false
    container.innerHTML = ''
    renderLogin(container)
    return true
  }

  // Drinks hidden by 5+ Hate reports from distinct voters. Read-only: the ban is computed from reports.
  async function loadBanned(): Promise<void> {
    tabContent.innerHTML = `<div class="skeleton" style="height:120px;border-radius:var(--radius-md)"></div>`
    let banned: BannedDrink[]
    try {
      banned = await fetchBannedDrinks()
    } catch (e: unknown) {
      if (sessionExpired(e)) return
      tabContent.innerHTML = `<div class="alert alert-error">Failed to load banned drinks</div>`
      return
    }
    if (activeTab !== 'banned') return
    if (banned.length === 0) {
      tabContent.innerHTML = `<p style="color:var(--text-muted)">No banned drinks</p>`
      return
    }
    tabContent.innerHTML = `
      <table class="leaderboard-table banned-drinks-table" style="font-size:13px">
        <thead><tr><th>Drink</th><th>Hates</th><th>Likes</th></tr></thead>
        <tbody>
          ${banned.map((drink) => `
            <tr data-soda-id="${drink.id}">
              <td>${escapeHtml(drink.name)}</td>
              <td style="font-variant-numeric:tabular-nums">${drink.hates}</td>
              <td style="font-variant-numeric:tabular-nums">${drink.likes}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  async function loadScans(): Promise<void> {
    tabContent.innerHTML = `<div class="skeleton" style="height:200px;border-radius:var(--radius-md)"></div>`
    let groups: UnknownScanGroup[]
    let catalog: Soda[]
    try {
      ;[groups, catalog] = await Promise.all([fetchUnknownScans(), getSodaCatalog()])
    } catch (e: unknown) {
      if (sessionExpired(e)) return
      tabContent.innerHTML = `<div class="alert alert-error">Failed to load unknown scans</div>`
      return
    }
    if (activeTab !== 'scans') return
    if (groups.length === 0) {
      tabContent.innerHTML = `<p style="color:var(--text-muted)">No unknown scans</p>`
      return
    }
    // Preselect the current mapping or the most-picked drink, but only one that can still be mapped
    // to (active). A removed drink is never preselected, so Map is not silently a no-op.
    const activeIds = new Set(catalog.map((soda) => soda.id))
    const preselect = (group: UnknownScanGroup): number | null =>
      [group.mapped_soda_id, ...group.picks.map((pick) => pick.soda_id)]
        .find((id): id is number => id != null && activeIds.has(id)) ?? null
    const options = (selected: number | null): string => [
      `<option value="">Drink…</option>`,
      ...catalog.map((soda) => `<option value="${soda.id}"${soda.id === selected ? ' selected' : ''}>${escapeHtml(soda.name)}</option>`),
    ].join('')
    tabContent.innerHTML = `
      <table class="leaderboard-table unknown-scans-table" style="font-size:13px">
        <thead>
          <tr>
            <th>Barcode</th>
            <th>Scans</th>
            <th>Voters</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th>Picked after</th>
            <th>Mapped</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${groups.map((group) => `
            <tr data-code="${escapeHtml(group.code)}">
              <td style="font-variant-numeric:tabular-nums">${escapeHtml(group.code)}</td>
              <td>${group.scans}</td>
              <td>${group.voters}</td>
              <td style="white-space:nowrap">${escapeHtml(formatSeen(group.first_seen))}</td>
              <td style="white-space:nowrap">${escapeHtml(formatSeen(group.last_seen))}</td>
              <td>${group.picks.map((pick) => `${escapeHtml(pick.name)} ×${pick.count}`).join('<br>') || '-'}</td>
              <td>${group.mapped_name ? `${escapeHtml(group.mapped_name)} (${escapeHtml(group.mapped_source ?? '')})` : '-'}</td>
              <td style="white-space:nowrap">
                <select class="form-input" style="width:180px;padding:4px 6px;font-size:12px;display:inline-block" aria-label="Drink for ${escapeHtml(group.code)}">
                  ${options(preselect(group))}
                </select>
                <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;margin-left:4px" data-action="map">Map</button>
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;margin-left:4px" data-action="dismiss">Dismiss</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `

    tabContent.querySelectorAll<HTMLButtonElement>('[data-action="map"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr')!
        const sodaId = Number(row.querySelector('select')!.value)
        if (!sodaId) return
        try {
          const res = await adminFetch('/admin/soda/barcodes', {
            method: 'POST',
            body: JSON.stringify({ code: row.dataset.code, soda_id: sodaId }),
          })
          if (!res.ok) throw new Error('Map failed')
          showAlert('Mapped!', 'success')
          await loadScans()
        } catch (e: unknown) {
          if (!sessionExpired(e)) showAlert('Map failed', 'error')
        }
      })
    })

    tabContent.querySelectorAll<HTMLButtonElement>('[data-action="dismiss"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr')!
        try {
          const res = await adminFetch(`/admin/soda/unknown-scans/${encodeURIComponent(row.dataset.code!)}`, { method: 'DELETE' })
          if (!res.ok) throw new Error('Dismiss failed')
          showAlert('Dismissed!', 'success')
          await loadScans()
        } catch (e: unknown) {
          if (!sessionExpired(e)) showAlert('Dismiss failed', 'error')
        }
      })
    })
  }

  loadTable()
}
