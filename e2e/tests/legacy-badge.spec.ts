import { test, expect } from '@playwright/test'
import { addLunchViaAPI, API_URL } from './helpers'

type LeaderboardLunch = { id: number; name: string; is_legacy: number }

async function seededLegacyLunch(): Promise<LeaderboardLunch> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  const { lunches } = await res.json() as { lunches: LeaderboardLunch[] }
  const lunch = lunches.find((l) => l.is_legacy === 1)
  if (!lunch) throw new Error('No seeded legacy lunch on leaderboard')
  return lunch
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Paula Legacy Lunch badge', () => {
  test('seeded lunch shows Legacy badge in leaderboard row', async ({ page }) => {
    const lunch = await seededLegacyLunch()
    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table tbody .lunch-name-row', { timeout: 15000 })
    const row = page.locator('.lunch-name-row').filter({
      has: page.getByText(new RegExp(`^${escapeRegExp(lunch.name)}$`)),
    }).first()
    await expect(row.locator('.legacy-badge')).toHaveText('Legacy')
  })

  test('seeded lunch detail shows Paula Legacy Lunch badge', async ({ page }) => {
    const lunch = await seededLegacyLunch()
    await page.goto(`/lunch/${lunch.id}`)
    await page.waitForSelector('.detail-name', { timeout: 15000 })
    await expect(page.locator('.detail-hero-info .legacy-badge-row .legacy-badge')).toHaveText('Paula Legacy Lunch')
  })

  test('new lunch is not legacy and shows no badge', async ({ page }) => {
    const id = await addLunchViaAPI(`E2E Non-Legacy ${Date.now()}`)

    const res = await fetch(`${API_URL}/api/lunches/${id}`)
    expect(res.ok).toBe(true)
    const lunch = await res.json() as { is_legacy: number }
    expect(lunch.is_legacy).toBe(0)

    await page.goto(`/lunch/${id}`)
    await page.waitForSelector('.detail-name', { timeout: 15000 })
    await expect(page.locator('.legacy-badge')).toHaveCount(0)
    await expect(page.locator('.legacy-badge-row')).toHaveCount(0)
  })
})
