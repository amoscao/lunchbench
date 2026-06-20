import { type Lunch } from '../api'

const API_URL = '/api'

type AdminState = {
  token: string | null
  lunches: Lunch[]
}

const state: AdminState = {
  token: sessionStorage.getItem('admin-token'),
  lunches: [],
}

export function renderAdmin(container: HTMLElement): void {
  container.innerHTML = ''
  const content = document.createElement('div')
  content.className = 'page-content'
  container.appendChild(content)

  if (!state.token) {
    renderLogin(content)
  } else {
    renderDashboard(content)
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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
      state.token = token
      sessionStorage.setItem('admin-token', token)
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
    headers: { Authorization: `Bearer ${state.token}` },
  })
  if (res.status === 401) {
    state.token = null
    sessionStorage.removeItem('admin-token')
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to load lunches')
  const data = await res.json()
  return data.lunches
}

async function fetchAdminStats(): Promise<{ votes_24h: number; votes_7d: number; votes_30d: number }> {
  const res = await fetch(`${API_URL}/admin/stats`, {
    headers: { Authorization: `Bearer ${state.token}` },
  })
  if (res.status === 401) {
    state.token = null
    sessionStorage.removeItem('admin-token')
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json()
}

function renderDashboard(container: HTMLElement): void {
  let activeTab: 'lunches' | 'stats' = 'lunches'

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h1 class="page-heading" style="margin:0">Admin Dashboard</h1>
      <button class="btn btn-secondary" id="logout-btn">Logout</button>
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

  container.querySelector('#logout-btn')!.addEventListener('click', () => {
    state.token = null
    sessionStorage.removeItem('admin-token')
    container.innerHTML = ''
    renderLogin(container)
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
                Authorization: `Bearer ${state.token}`,
              },
              body: JSON.stringify(updates),
            })
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
            headers: { Authorization: `Bearer ${state.token}` },
          })
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
