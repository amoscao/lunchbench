import { type LeaderboardLunch, type LeaderboardPage, type Lunch } from '../api'
import { escapeHtml } from '../utils/escape-html'

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

async function revokeAdminSession(token: string | null): Promise<void> {
  if (!token) return
  await fetch(`${API_URL}/admin/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function exportLeaderboardPDF(token: string | null): Promise<void> {
  void token

  const res = await fetch('/api/lunches/leaderboard')
  if (!res.ok) throw new Error('Failed to load leaderboard')
  const { lunches }: LeaderboardPage = await res.json()

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

function renderDashboard(container: HTMLElement): void {
  let activeTab: 'lunches' | 'stats' = 'lunches'

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
  const tabContent = container.querySelector<HTMLElement>('#admin-tab-content')!

  function setTab(tab: 'lunches' | 'stats'): void {
    activeTab = tab
    const accentStyle = `padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid var(--accent);color:var(--accent);cursor:pointer;margin-bottom:-1px`
    const inactiveStyle = `padding:8px 18px;font-size:13px;font-weight:600;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary);cursor:pointer;margin-bottom:-1px`
    tabLunches.style.cssText = tab === 'lunches' ? accentStyle : inactiveStyle
    tabStats.style.cssText   = tab === 'stats'   ? accentStyle : inactiveStyle
    if (tab === 'lunches') {
      tabContent.innerHTML = `<div id="admin-table-wrap"><div class="skeleton" style="height:200px;border-radius:var(--radius-md)"></div></div>`
      loadTable()
    } else {
      loadStats()
    }
  }

  tabLunches.addEventListener('click', () => setTab('lunches'))
  tabStats.addEventListener('click',   () => setTab('stats'))

  const exportPdfBtn = container.querySelector<HTMLButtonElement>('#export-pdf-btn')!
  exportPdfBtn.addEventListener('click', async () => {
    exportPdfBtn.disabled = true
    exportPdfBtn.textContent = 'Exporting…'
    try {
      await exportLeaderboardPDF(adminToken)
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

  loadTable()
}
