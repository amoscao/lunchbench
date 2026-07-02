import { test, expect, type Page } from '@playwright/test'
import { ADMIN_TOKEN, API_URL, addLunchViaAPI, getAdminSessionToken } from './helpers'

type LunchEntry = {
  id: number
  name: string
  wins: number
  losses: number
  ties: number
}

type TestDish = {
  id: number
  name: string
}

function uniqueDishName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function addLunchViaUI(page: Page, name: string): Promise<number> {
  await page.goto('/add')
  await page.fill('input[type="text"]', name)
  await page.fill('input[type="password"]', ADMIN_TOKEN)

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/lunches') && r.request().method() === 'POST'),
    page.locator('button.btn-primary').click(),
  ])
  if (!response.ok()) {
    const errBody = await response.json().catch(() => ({}))
    throw new Error(`Failed to add lunch via UI: HTTP ${response.status()} — ${JSON.stringify(errBody)}`)
  }
  const body = await response.json() as { lunch: { id: number } }
  await expect(page.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  return body.lunch.id
}

async function injectMatchupPair(
  page: Page,
  dishA: TestDish,
  dishB: TestDish
): Promise<void> {
  await page.route('**/api/matchup**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() !== 'GET' || url.pathname !== '/api/matchup') {
      await route.continue()
      return
    }

    const response = await route.fetch()
    if (response.status() !== 200) {
      await route.fulfill({ response })
      return
    }

    const body = await response.json()
    await route.fulfill({
      response,
      json: {
        ...body,
        status: 'ok',
        left: {
          id: dishA.id,
          name: dishA.name,
          rank: 1,
          rating: 1500,
          conservative_rating: 800,
          is_vegan: 0,
          wins: 0,
          losses: 0,
          ties: 0,
        },
        right: {
          id: dishB.id,
          name: dishB.name,
          rank: 2,
          rating: 1500,
          conservative_rating: 800,
          is_vegan: 0,
          wins: 0,
          losses: 0,
          ties: 0,
        },
        matchup_token: body.matchup_token,
        projected: body.projected,
      },
    })
  })
}

async function getLeaderboardLunch(id: number): Promise<LunchEntry> {
  const res = await fetch(`${API_URL}/api/lunches/leaderboard`)
  if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`)
  const body = await res.json() as { lunches: LunchEntry[] }
  const lunch = body.lunches.find((l) => l.id === id)
  if (!lunch) throw new Error(`Lunch ${id} not found on leaderboard`)
  return lunch
}

async function voteViaBrowserAPI(
  page: Page,
  leftId: number,
  rightId: number,
  result: 'left_win' | 'right_win' | 'tie'
): Promise<void> {
  await page.goto('/')
  const response = await page.evaluate(
    async ({ leftId, rightId, result }) => {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left_lunch_id: leftId, right_lunch_id: rightId, result }),
      })
      return {
        ok: res.ok,
        status: res.status,
        body: await res.json().catch(() => ({})),
      }
    },
    { leftId, rightId, result }
  )

  if (!response.ok) {
    throw new Error(`Browser vote setup failed: HTTP ${response.status} ${JSON.stringify(response.body)}`)
  }
}

async function addLunchViaRateLimitSafeAPI(name: string): Promise<number> {
  try {
    return await addLunchViaAPI(name)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('429')) throw error
  }

  const token = await getAdminSessionToken()
  const clientIp = `10.20.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`
  const res = await fetch(`${API_URL}/api/lunches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'CF-Connecting-IP': clientIp,
      'X-Forwarded-For': clientIp,
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Failed to add lunch with dedicated E2E client IP: ${res.status} ${JSON.stringify(body)}`)
  }
  const data = await res.json() as { lunch: { id: number } }
  return data.lunch.id
}

test.describe('Comprehensive vote flow', () => {
  test('full UI flow - add dishes, vote, verify leaderboard', async ({ page }) => {
    const dishAName = uniqueDishName('Vote Flow UI A')
    const dishBName = uniqueDishName('Vote Flow UI B')
    const dishAId = await addLunchViaUI(page, dishAName)
    const dishBId = await addLunchViaUI(page, dishBName)

    await injectMatchupPair(page, { id: dishAId, name: dishAName }, { id: dishBId, name: dishBName })
    await page.goto('/')
    await page.waitForSelector('.vote-arena', { timeout: 15000 })

    await expect(page.locator('.vote-arena').getByText(dishAName)).toBeVisible()
    await expect(page.locator('.vote-arena').getByText(dishBName)).toBeVisible()

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/vote') && r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('.vote-buttons .btn').nth(0).click(),
    ])

    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table', { timeout: 15000 })
    await expect(page.locator('.leaderboard-table')).toContainText(dishAName)
    await expect(page.locator('.leaderboard-table')).toContainText(dishBName)

    const dishAEntry = await getLeaderboardLunch(dishAId)
    const dishBEntry = await getLeaderboardLunch(dishBId)
    expect(dishAEntry.wins).toBe(1)
    expect(dishAEntry.losses).toBe(0)
    expect(dishBEntry.wins).toBe(0)
    expect(dishBEntry.losses).toBe(1)
  })

  test.describe('API-seeded pairs', () => {
    let tieA: TestDish
    let tieB: TestDish

    test.beforeAll(async () => {
      const tieAName = uniqueDishName('Vote Flow Tie A')
      const tieBName = uniqueDishName('Vote Flow Tie B')

      tieA = { id: await addLunchViaRateLimitSafeAPI(tieAName), name: tieAName }
      tieB = { id: await addLunchViaRateLimitSafeAPI(tieBName), name: tieBName }
    })

    test('tie vote updates both dishes correctly', async ({ page }) => {
      await injectMatchupPair(page, tieA, tieB)

      await page.goto('/')
      await page.waitForSelector('.vote-arena', { timeout: 15000 })

      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/vote') && r.request().method() === 'POST', { timeout: 10000 }),
        page.locator('.vote-buttons .btn').nth(1).click(),
      ])

      const dishAEntry = await getLeaderboardLunch(tieA.id)
      const dishBEntry = await getLeaderboardLunch(tieB.id)
      expect(dishAEntry.wins).toBe(0)
      expect(dishAEntry.losses).toBe(0)
      expect(dishAEntry.ties).toBe(1)
      expect(dishBEntry.wins).toBe(0)
      expect(dishBEntry.losses).toBe(0)
      expect(dishBEntry.ties).toBe(1)
    })
  })
})
