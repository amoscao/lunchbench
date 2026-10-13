import { test, expect } from '@playwright/test'
import { addLunchViaAPI, API_URL } from './helpers'

const SEEDED_LUNCH = 'Margherita Pizza'

async function seededLunchId(): Promise<number> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  const { lunches } = await res.json() as { lunches: { id: number; name: string }[] }
  const lunch = lunches.find((l) => l.name === SEEDED_LUNCH)
  if (!lunch) throw new Error(`Seeded lunch ${SEEDED_LUNCH} not found`)
  return lunch.id
}

test.describe('Paula Legacy Lunch badge', () => {
  test('seeded lunch shows Legacy badge in leaderboard row', async ({ page }) => {
    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table tbody .lunch-name-row', { timeout: 15000 })
    const row = page.locator('.lunch-name-row', { hasText: SEEDED_LUNCH })
    await expect(row.locator('.legacy-badge')).toHaveText('Legacy')
  })

  test('seeded lunch detail shows Paula Legacy Lunch badge', async ({ page }) => {
    const id = await seededLunchId()
    await page.goto(`/lunch/${id}`)
    await page.waitForSelector('.detail-name', { timeout: 15000 })
    await expect(page.locator('.detail-name .legacy-badge')).toHaveText('Paula Legacy Lunch')
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
  })
})
