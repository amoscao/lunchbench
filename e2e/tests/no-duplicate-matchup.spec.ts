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

async function createVotePair(): Promise<{ left: LunchSnapshot; right: LunchSnapshot }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const leftId = await addLunchViaAPI(`Vote Flow A ${suffix}`)
  const rightId = await addLunchViaAPI(`Vote Flow B ${suffix}`)
  return {
    left: await getLunchSnapshot(leftId),
    right: await getLunchSnapshot(rightId),
  }
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

  test('vote updates win/loss counters', async ({ page: _page }) => {
    const { left, right } = await createVotePair()

    const res = await fetch(`${API_URL}/api/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ left_lunch_id: left.id, right_lunch_id: right.id, result: 'left_win' }),
    })
    expect(res.ok).toBe(true)

    const updatedLeft = await getLunchSnapshot(left.id)
    const updatedRight = await getLunchSnapshot(right.id)
    expect(updatedLeft.wins).toBe(left.wins + 1)
    expect(updatedRight.losses).toBe(right.losses + 1)
  })

  test('leaderboard reflects vote', async ({ page }) => {
    const { left, right } = await createVotePair()

    const res = await fetch(`${API_URL}/api/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ left_lunch_id: left.id, right_lunch_id: right.id, result: 'left_win' }),
    })
    expect(res.ok).toBe(true)

    await page.goto('/leaderboard')
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: left.name })).toBeVisible()
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: right.name })).toBeVisible()

    const updatedLeft = await getLeaderboardLunch(left.id)
    const updatedRight = await getLeaderboardLunch(right.id)
    expect(updatedLeft.wins).toBe(left.wins + 1)
    expect(updatedRight.losses).toBe(right.losses + 1)
    expect(updatedLeft.conservative_rating).not.toBe(left.conservative_rating)
    expect(updatedRight.conservative_rating).not.toBe(right.conservative_rating)
  })
})
