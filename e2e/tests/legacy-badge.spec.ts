import { test, expect } from '@playwright/test'
import { addLunchViaAPI, API_URL, waitForMatchup } from './helpers'

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

  test('arena shows Paula Legacy Lunch badge only on legacy card', async ({ page }) => {
    await page.route('**/api/matchup**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET' || url.pathname !== '/api/matchup') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const body = await response.json()
      if (body.left && body.right) {
        body.left.is_legacy = 1
        body.right.is_legacy = 0
      }
      await route.fulfill({ response, json: body })
    })

    await page.goto('/')
    await waitForMatchup(page)
    const badges = page.locator('.lunch-card-info > .legacy-badge-row .legacy-badge')
    await expect(badges).toHaveCount(1)
    await expect(badges).toHaveText('Paula Legacy Lunch')
  })

  test('arena legacy badge stays fully visible on mobile with a long name', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/matchup**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET' || url.pathname !== '/api/matchup') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const body = await response.json()
      if (body.left && body.right) {
        body.left.is_legacy = 1
        body.left.name = 'Extremely Long Braised Short Rib With Garlic Mashed Potatoes And Greens'
        body.right.is_legacy = 0
      }
      await route.fulfill({ response, json: body })
    })

    await page.goto('/')
    await waitForMatchup(page)
    const card = page.locator('.lunch-card').filter({ has: page.locator('.legacy-badge') })
    const badge = card.locator('.legacy-badge')
    await expect(badge).toBeVisible()
    const cardBox = await card.locator('.lunch-card-info').boundingBox()
    const badgeBox = await badge.boundingBox()
    if (!cardBox || !badgeBox) throw new Error('Missing bounding box')
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
    expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height)
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
