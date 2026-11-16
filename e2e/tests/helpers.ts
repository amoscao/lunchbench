import { Page } from '@playwright/test'

export const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? 'test-admin-token'
export const API_URL = process.env.API_URL ?? 'http://localhost:8787'
export const ADMIN_MANAGER_PASSWORD = process.env.E2E_ADMIN_MANAGER_PASSWORD ?? 'test-admin-manager-password'
export const PURCHASER_PASSWORD = process.env.E2E_PURCHASER_PASSWORD ?? 'test-purchaser-password'

let adminSessionToken: string | null = null
let adminSessionPromise: Promise<string> | null = null

export async function getAdminSessionToken(): Promise<string> {
  if (adminSessionToken) return adminSessionToken
  if (adminSessionPromise) return adminSessionPromise

  adminSessionPromise = (async (): Promise<string> => {
    const res = await fetch(`${API_URL}/api/admin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_TOKEN }),
    })
    if (!res.ok) {
      throw new Error(`Failed to verify admin token: ${res.status}`)
    }
    const data = await res.json() as { token: string }
    adminSessionToken = data.token
    return data.token
  })()

  try {
    return await adminSessionPromise
  } catch (error) {
    adminSessionPromise = null
    throw error
  }
}

export async function waitForMatchup(page: Page): Promise<void> {
  await page.waitForSelector('.vote-arena', { timeout: 15000 })
  await page.waitForSelector('.vote-buttons', { timeout: 5000 })
}

export async function castVote(page: Page, which: 'left' | 'tie' | 'right'): Promise<void> {
  await waitForMatchup(page)
  const buttons = page.locator('.vote-buttons .btn')
  if (which === 'left') await buttons.nth(0).click()
  else if (which === 'tie') await buttons.nth(1).click()
  else await buttons.nth(2).click()
  await page.waitForTimeout(500)
}

export async function addLunchViaAPI(name: string): Promise<number> {
  const token = await getAdminSessionToken()
  const res = await fetch(`${API_URL}/api/lunches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`Failed to add lunch: ${res.status}`)
  const data = await res.json() as { lunch: { id: number } }
  return data.lunch.id
}

export async function verifyPassword(password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`Failed to verify password: ${res.status}`)
  const data = await res.json() as { token: string }
  return data.token
}

export type SodaRow = {
  id: number
  name: string
  type: 'soda' | 'seltzer'
  rank: number
  right_swipes: number
  left_swipes: number
  likes: number
  hates: number
  has_data: boolean
}

export async function getSodaLeaderboard(): Promise<SodaRow[]> {
  const res = await fetch(`${API_URL}/api/soda/leaderboard`)
  if (!res.ok) throw new Error(`Soda leaderboard failed: ${res.status}`)
  return (await res.json() as { sodas: SodaRow[] }).sodas
}

export async function getSodaRow(id: number): Promise<SodaRow> {
  const row = (await getSodaLeaderboard()).find((soda) => soda.id === id)
  if (!row) throw new Error(`Soda ${id} not on leaderboard`)
  return row
}

export async function putSodaSwipe(session: string, sodaId: number, direction: 'right' | 'left'): Promise<void> {
  const res = await fetch(`${API_URL}/api/soda/swipes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': session },
    body: JSON.stringify({ soda_id: sodaId, direction }),
  })
  if (!res.ok) throw new Error(`Swipe failed: ${res.status}`)
}
