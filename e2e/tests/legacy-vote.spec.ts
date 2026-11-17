import { test, expect } from '@playwright/test'
import { API_URL, waitForMatchup } from './helpers'

// #286: votes naming a legacy lunch (Paula Legacy Lunch) are rejected with 409 LEGACY_LUNCH.
type LeaderboardLunch = {
  id: number
  name: string
  is_vegan: number
  is_legacy: number
  rating: number
  wins: number
  losses: number
}

async function seededPair(): Promise<{ legacy: LeaderboardLunch; current: LeaderboardLunch }> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  const { lunches } = await res.json() as { lunches: LeaderboardLunch[] }
  const legacy = lunches.find((l) => l.is_legacy === 1)
  if (!legacy) throw new Error('No seeded legacy lunch on leaderboard')
  const current = lunches.find((l) => l.is_legacy === 0 && l.is_vegan === legacy.is_vegan)
  if (!current) throw new Error('No non-legacy lunch in the legacy lunch category')
  return { legacy, current }
}

async function lunchById(id: number): Promise<LeaderboardLunch> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  const { lunches } = await res.json() as { lunches: LeaderboardLunch[] }
  return lunches.find((l) => l.id === id)!
}

test.describe('Legacy lunch votes', () => {
  test('POST /api/vote rejects a legacy lunch on either side and changes nothing', async ({ request }) => {
    const { legacy, current } = await seededPair()

    for (const [left, right] of [[legacy.id, current.id], [current.id, legacy.id]]) {
      const res = await request.post(`${API_URL}/api/vote`, {
        data: { left_lunch_id: left, right_lunch_id: right, result: 'left_win' },
      })
      expect(res.status()).toBe(409)
      expect(await res.json()).toEqual({ error: 'Legacy lunches cannot be voted on', code: 'LEGACY_LUNCH' })
    }

    const after = await lunchById(legacy.id)
    expect(after.rating).toBe(legacy.rating)
    expect(after.wins).toBe(legacy.wins)
    expect(after.losses).toBe(legacy.losses)
  })

  test('a stale tab voting on a legacy matchup moves on to a new matchup without an error', async ({ page }) => {
    const { legacy, current } = await seededPair()
    let servedStale = false

    // Serve one matchup containing the legacy lunch, as a tab opened before #284 would have; then use the real API.
    await page.route('**/api/matchup**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/matchup/seen') {
        const body = route.request().postDataJSON() as { token?: string }
        if (body.token === 'stale-legacy-token') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
          return
        }
        await route.continue()
        return
      }
      if (servedStale) {
        await route.continue()
        return
      }
      servedStale = true
      const lunch = (l: LeaderboardLunch) => ({ ...l, description: null, image_key: null, image_url: null, rank: 1 })
      const projected = { rating: 1500, conservative_rating: 800, rank: 1 }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          matchup_token: 'stale-legacy-token',
          left: lunch(legacy),
          right: lunch(current),
          projected: {
            left_win: { left: projected, right: projected },
            right_win: { left: projected, right: projected },
            tie: { left: projected, right: projected },
          },
        }),
      })
    })

    const voteStatuses: number[] = []
    page.on('response', (res) => {
      if (new URL(res.url()).pathname === '/api/vote') voteStatuses.push(res.status())
    })

    await page.goto('/')
    await waitForMatchup(page)
    await expect(page.locator('.lunch-card-name').nth(0)).toContainText(legacy.name)

    await page.locator('.vote-buttons .btn').nth(0).click()

    // The next matchup comes from the real API, which never serves the legacy lunch.
    await expect(page.locator('.lunch-card-name').filter({ hasText: legacy.name })).toHaveCount(0, { timeout: 10000 })
    await waitForMatchup(page)
    await expect(page.locator('.vote-buttons .btn').nth(0)).toBeEnabled()
    await expect(page.locator('.vote-notice')).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    // One attempt only: a legacy rejection is not retried.
    expect(voteStatuses).toEqual([409])
  })
})
