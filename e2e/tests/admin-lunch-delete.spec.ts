import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from './fixtures'
import { ADMIN_MANAGER_PASSWORD, API_URL, getAdminSessionToken, verifyPassword } from './helpers'

// #308: admin lunch delete on the local D1 (foreign keys on, as in prod) for lunches that have
// been shown in matchups. Vegan lunches, because the seed has none, so the vegan pool is small and
// a session can be shown every pair in it.

// Lunches this spec created; afterEach deletes them, pass or fail, so later specs see only the
// seed's (zero) vegan lunches.
const created: number[] = []

async function addVeganLunch(name: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/lunches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAdminSessionToken()}` },
    body: JSON.stringify({ name, is_vegan: true }),
  })
  expect(res.status).toBe(201)
  const id = ((await res.json()) as { lunch: { id: number } }).lunch.id
  created.push(id)
  return id
}

// Shows one session every vegan pair: GET /api/matchup and POST /seen until exhausted.
// Returns the pairs shown.
async function presentEveryVeganPair(): Promise<string[]> {
  const session = randomUUID()
  const shown: string[] = []
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${API_URL}/api/matchup?vegan=true`, { headers: { 'X-Lunchbench-Session': session } })
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; matchup_token?: string; left?: { id: number }; right?: { id: number } }
    if (body.status === 'exhausted') return shown
    shown.push([body.left!.id, body.right!.id].sort((a, b) => a - b).join(':'))
    const seen = await fetch(`${API_URL}/api/matchup/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.matchup_token }),
    })
    expect(seen.status).toBe(200)
  }
  throw new Error('vegan matchups never exhausted')
}

async function adminDelete(id: number): Promise<number> {
  const token = await verifyPassword(ADMIN_MANAGER_PASSWORD)
  const res = await fetch(`${API_URL}/api/admin/lunches/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  return res.status
}

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/admin')
  await page.locator('#admin-pw').fill(ADMIN_MANAGER_PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
}

test.describe('Admin lunch delete', () => {
  // Deleting an id that is already gone also answers 200.
  test.afterEach(async () => {
    for (const id of created.splice(0)) expect(await adminDelete(id)).toBe(200)
  })

  test('deletes a lunch that has been shown in matchups and shows success', async ({ page }) => {
    const suffix = randomUUID().slice(0, 8)
    const target = await addVeganLunch(`Delete Me ${suffix}`)
    const other = await addVeganLunch(`Keep Me ${suffix}`)
    const pair = [target, other].sort((a, b) => a - b).join(':')
    expect(await presentEveryVeganPair()).toContain(pair)

    await openAdmin(page)
    const row = page.locator(`tr[data-id="${target}"]`)
    await expect(row).toBeVisible()
    page.once('dialog', (dialog) => void dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()

    await expect(page.locator('#admin-alert')).toHaveText('Deleted!')
    await expect(page.locator('#admin-alert')).toHaveClass(/alert-success/)
    await expect(row).toHaveCount(0)
    expect((await fetch(`${API_URL}/api/lunches/${target}`)).status).toBe(404)
    expect((await fetch(`${API_URL}/api/lunches/${other}`)).status).toBe(200)
  })

  test('a failed delete shows an error and keeps the row', async ({ page }) => {
    const target = await addVeganLunch(`Keep On Error ${randomUUID().slice(0, 8)}`)
    await page.route(`**/api/admin/lunches/${target}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal Server Error' }) })
    })

    await openAdmin(page)
    const row = page.locator(`tr[data-id="${target}"]`)
    page.once('dialog', (dialog) => void dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()

    await expect(page.locator('#admin-alert')).toHaveText('Delete failed')
    await expect(page.locator('#admin-alert')).toHaveClass(/alert-error/)
    await expect(row).toBeVisible()
    expect((await fetch(`${API_URL}/api/lunches/${target}`)).status).toBe(200)
  })
})
