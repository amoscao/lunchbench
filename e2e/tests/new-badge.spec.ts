import { test, expect } from './fixtures'
import { addLunchViaAPI, API_URL, waitForMatchup } from './helpers'

type LeaderboardLunch = { id: number; name: string; is_legacy: number; created_at: string }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// D1 datetime('now') format: UTC, no zone suffix.
function d1Datetime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

test.describe('New food badge', () => {
  test('lunch added via API shows New badge in leaderboard row', async ({ page }) => {
    const name = `E2E New Badge ${Date.now()}`
    await addLunchViaAPI(name)

    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table tbody .lunch-name-row', { timeout: 15000 })
    const row = page.locator('.lunch-name-row').filter({
      has: page.getByText(new RegExp(`^${escapeRegExp(name)}$`)),
    }).first()
    await expect(row.locator('.new-badge')).toHaveText('New')
  })

  test('seeded lunch shows no New badge in leaderboard row', async ({ page }) => {
    const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
    const { lunches } = await res.json() as { lunches: LeaderboardLunch[] }
    const seeded = lunches.find((l) => l.name === 'Margherita Pizza')
    if (!seeded) throw new Error('Seeded lunch Margherita Pizza not on leaderboard')
    // seed.sql backdates created_at; a fresh datetime('now') would make it look new.
    expect(seeded.created_at.startsWith('2024-')).toBe(true)

    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table tbody .lunch-name-row', { timeout: 15000 })
    const row = page.locator('.lunch-name-row').filter({
      has: page.getByText(/^Margherita Pizza$/),
    }).first()
    await expect(row).toBeVisible()
    await expect(row.locator('.new-badge')).toHaveCount(0)
  })

  test('arena shows New food! only on the new card, alongside Legacy badge', async ({ page }) => {
    await page.route('**/api/matchup**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET' || url.pathname !== '/api/matchup') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const body = await response.json()
      if (body.left && body.right) {
        body.left.created_at = d1Datetime(Date.now() - 60 * 60 * 1000)
        body.left.is_legacy = 1
        body.right.created_at = d1Datetime(Date.now() - 8 * 24 * 60 * 60 * 1000)
        body.right.is_legacy = 0
      }
      await route.fulfill({ response, json: body })
    })

    await page.goto('/')
    await waitForMatchup(page)
    const names = page.locator('.lunch-card-name')
    await expect(names.nth(0).locator('.new-badge')).toHaveText('New food!')
    await expect(page.locator('.lunch-card-info').nth(0).locator('.legacy-badge-row .legacy-badge')).toHaveText('Paula Legacy Lunch')
    await expect(names.nth(1).locator('.new-badge')).toHaveCount(0)
  })
})
