import { test, expect } from '@playwright/test'
import { ADMIN_MANAGER_PASSWORD, API_URL } from './helpers'

// Issue #298: Hate reports from 5 distinct voters ban a drink everywhere.
const NAME = 'Polar Orange Vanilla'
// Same brand, not reported: the ban hides one drink, not its brand.
const BRAND_MATE = 'Polar Original'

async function sodaId(): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/catalog`)
  const { sodas } = await res.json() as { sodas: { id: number; name: string }[] }
  const soda = sodas.find((s) => s.name === NAME)
  if (!soda) throw new Error(`${NAME} not in catalog`)
  return soda.id
}

async function hate(sodaId: number): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': crypto.randomUUID() },
    body: JSON.stringify({ soda_id: sodaId, verdict: 'hate' }),
  })
  return res.status
}

test.describe('Auto-ban after 5 Hate reports', () => {
  // Stateful: the first test bans the drink and the second reads the result, so no retries.
  test.describe.configure({ mode: 'serial', retries: 0 })

  test('5 voters reporting Hate make the drink vanish from /soda, /leaderboard/soda and report search', async ({ page }) => {
    const id = await sodaId()
    for (let i = 0; i < 4; i++) expect(await hate(id)).toBe(200)

    // Still shown after 4 hates.
    await page.goto('/leaderboard/soda')
    await expect(page.locator(`.soda-table tbody tr[data-soda-id="${id}"]`)).toHaveCount(1)

    expect(await hate(id)).toBe(200)

    // Leaderboard.
    await page.goto('/leaderboard/soda')
    await expect(page.locator('.soda-table tbody tr[data-soda-id]').first()).toBeVisible()
    await expect(page.locator(`.soda-table tbody tr[data-soda-id="${id}"]`)).toHaveCount(0)

    // Report search.
    await page.goto('/soda')
    await page.getByRole('button', { name: 'Report a soda' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a soda' })
    await dialog.getByRole('combobox').fill('polar')
    // Waiting for the brand-mate proves the suggestions rendered before checking the banned drink is absent.
    await expect(dialog.locator('.soda-suggest-item', { hasText: BRAND_MATE })).toHaveCount(1)
    await expect(dialog.locator('.soda-suggest-item', { hasText: NAME })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Swipe feed: the page's whole feed (all unswiped drinks for its session) leaves the drink out,
    // and no rendered card shows it. No swiping here, so later specs still see untouched drinks.
    await expect(page.locator('.soda-card[data-depth="0"]')).toBeVisible()
    const session = await page.evaluate(() => localStorage.getItem('lb_session_id') ?? '')
    const feed = await fetch(`${API_URL}/api/soda/deck`, { headers: { 'X-Lunchbench-Session': session } })
    const feedIds = (await feed.json() as { sodas: { id: number }[] }).sodas.map((soda) => soda.id)
    expect(feedIds.length).toBeGreaterThan(0)
    expect(feedIds).not.toContain(id)
    await expect(page.locator(`.soda-card[data-soda-id="${id}"]`)).toHaveCount(0)

    // A further report on the banned drink is rejected with a clear code.
    const rejected = await fetch(`${API_URL}/api/soda/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': crypto.randomUUID() },
      body: JSON.stringify({ soda_id: id, verdict: 'like' }),
    })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ code: 'SODA_BANNED' })
  })

  test('the admin page lists banned drinks with hate and like counts, and Unban brings one back', async ({ page }) => {
    const id = await sodaId().catch(() => null)
    // The drink is banned by the previous test, so it is gone from the catalog.
    expect(id).toBeNull()
    await page.goto('/admin')
    await page.locator('#admin-pw').fill(ADMIN_MANAGER_PASSWORD)
    await page.locator('#login-btn').click()
    await page.getByRole('button', { name: 'Banned drinks' }).click()
    const row = page.locator('.banned-drinks-table tbody tr', { hasText: NAME })
    await expect(row).toHaveCount(1)
    await expect(row.locator('td').nth(1)).toHaveText('5')
    await expect(row.locator('td').nth(2)).toHaveText('0')

    await row.getByRole('button', { name: `Unban ${NAME}` }).click()
    await expect(page.locator('.banned-drinks-table tbody tr', { hasText: NAME })).toHaveCount(0)
    expect(await sodaId()).toBeGreaterThan(0)
    // The unban holds until 5 new Hates, so leave it unbanned for later specs: 4 more stay shown.
    for (let i = 0; i < 4; i++) expect(await hate(await sodaId())).toBe(200)
    expect(await sodaId()).toBeGreaterThan(0)
  })
})
