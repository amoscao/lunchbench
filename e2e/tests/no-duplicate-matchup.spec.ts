import { test, expect } from '@playwright/test'
import { addLunchViaAPI, API_URL, castVote, waitForMatchup } from './helpers'

type LunchSnapshot = {
  id: number
  name: string
  rating: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
  rank?: number
}

function pairKey(leftId: number, rightId: number): string {
  const [low, high] = [leftId, rightId].sort((a, b) => a - b)
  return `${low}-${high}`
}

async function getLunchSnapshot(id: number): Promise<LunchSnapshot> {
  const res = await fetch(`${API_URL}/api/lunches/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch lunch ${id}: ${res.status}`)
  return await res.json() as LunchSnapshot
}

async function getLeaderboardLunch(id: number): Promise<LunchSnapshot> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`)
  const body = await res.json() as { lunches: LunchSnapshot[] }
  const lunch = body.lunches.find((item) => item.id === id)
  if (!lunch) throw new Error(`Lunch ${id} not found on leaderboard`)
  return lunch
}

test.describe('No duplicate matchups', () => {
  test('no duplicate pair in sequential voting', async ({ page }) => {
    const pairs: string[] = []

    await page.route('/api/matchup**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      if (response.status() === 200) {
        const body = await response.json()
        if (body.status === 'ok') {
          pairs.push(pairKey(body.left.id, body.right.id))
        }
        await route.fulfill({ response, json: body })
        return
      }
      await route.fulfill({ response })
    })

    await page.goto('/')
    await waitForMatchup(page)

    for (let i = 0; i < 5; i++) {
      await castVote(page, 'left')
    }

    const renderedPairs = pairs.slice(0, 5)
    expect(renderedPairs).toHaveLength(5)
    expect(new Set(renderedPairs).size).toBe(renderedPairs.length)
  })
})

// Vote counter and leaderboard tests share one lunch pair to stay under the
// lunch_create rate limit (10 per day per IP across the whole E2E suite).
test.describe('Vote correctness', () => {
  let leftId: number
  let rightId: number
  let leftName: string
  let rightName: string
  let beforeLeft: LunchSnapshot
  let beforeRight: LunchSnapshot

  test.beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    leftName = `Vote Flow A ${suffix}`
    rightName = `Vote Flow B ${suffix}`
    leftId = await addLunchViaAPI(leftName)
    rightId = await addLunchViaAPI(rightName)
    beforeLeft = await getLunchSnapshot(leftId)
    beforeRight = await getLunchSnapshot(rightId)

    const res = await fetch(`${API_URL}/api/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ left_lunch_id: leftId, right_lunch_id: rightId, result: 'left_win' }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(`Vote setup failed: HTTP ${res.status} — ${JSON.stringify(body)}`)
    }
  })

  test('vote updates win/loss counters', async () => {
    const updatedLeft = await getLunchSnapshot(leftId)
    const updatedRight = await getLunchSnapshot(rightId)
    expect(updatedLeft.wins).toBe(beforeLeft.wins + 1)
    expect(updatedRight.losses).toBe(beforeRight.losses + 1)
  })

  test('leaderboard reflects vote', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: leftName })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: rightName })).toBeVisible({ timeout: 15000 })

    const updatedLeft = await getLeaderboardLunch(leftId)
    const updatedRight = await getLeaderboardLunch(rightId)
    expect(updatedLeft.wins).toBe(beforeLeft.wins + 1)
    expect(updatedRight.losses).toBe(beforeRight.losses + 1)
    expect(updatedLeft.conservative_rating).not.toBe(beforeLeft.conservative_rating)
    expect(updatedRight.conservative_rating).not.toBe(beforeRight.conservative_rating)
  })
})
