import { test, expect } from '@playwright/test'
import { waitForMatchup } from './helpers'

// 3 fake non-vegan lunches → 3 unique pairs covers all combinations
const FAKE_LUNCHES = [
  { id: 9001, name: 'Test Pizza' },
  { id: 9002, name: 'Test Burger' },
  { id: 9003, name: 'Test Tacos' },
] as const

type FakeLunch = (typeof FAKE_LUNCHES)[number]

// All 3 unique pairs in deterministic order
const FAKE_PAIRS: [FakeLunch, FakeLunch][] = [
  [FAKE_LUNCHES[0], FAKE_LUNCHES[1]],
  [FAKE_LUNCHES[0], FAKE_LUNCHES[2]],
  [FAKE_LUNCHES[1], FAKE_LUNCHES[2]],
]

function makeLunchJson(l: FakeLunch) {
  return {
    id: l.id,
    name: l.name,
    description: null,
    image_key: null,
    image_url: null,
    is_vegan: 0,
    rank: 1,
    rating: 1500,
    conservative_rating: 1350,
    wins: 0,
    losses: 0,
    ties: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function makeMatchupJson(left: FakeLunch, right: FakeLunch) {
  const r = { rating: 1500, conservative_rating: 1350, rank: 1 }
  return {
    status: 'ok',
    matchup_token: `${left.id}-${right.id}`,
    left: makeLunchJson(left),
    right: makeLunchJson(right),
    projected: {
      left_win: { left: r, right: { ...r, rank: 2 } },
      right_win: { left: { ...r, rank: 2 }, right: r },
      tie: { left: r, right: r },
    },
  }
}

test.describe('Exhausted matchups', () => {
  test('shows exhausted message after all pairs have been voted on', async ({ page }) => {
    const shownPairs: Array<{ left: string; right: string }> = []
    const seenTokens = new Set<string>()

    await page.route('**/api/matchup**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/api/matchup/seen') {
        const body = request.postDataJSON() as { token?: string }
        if (body.token) seenTokens.add(body.token)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      if (seenTokens.size >= FAKE_PAIRS.length) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'exhausted' }),
        })
        return
      }

      const idx = seenTokens.size
      const [left, right] = FAKE_PAIRS[idx]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeMatchupJson(left, right)),
      })
    })

    await page.route('**/api/vote', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          vote_id: Math.floor(Math.random() * 100000),
          left_result: { rating: 1520, conservative_rating: 1370, rank: 1 },
          right_result: { rating: 1480, conservative_rating: 1330, rank: 2 },
        }),
      })
    })

    await page.goto('/')

    // Vote through all unique pairs, recording each one
    for (let round = 0; round < FAKE_PAIRS.length; round++) {
      await waitForMatchup(page)

      const leftName = (await page.locator('.lunch-card-name').nth(0).textContent())?.trim() ?? ''
      const rightName = (await page.locator('.lunch-card-name').nth(1).textContent())?.trim() ?? ''

      // Confirm the shown lunches are from the fake pool
      const leftLunch = FAKE_LUNCHES.find((l) => leftName.includes(l.name))
      const rightLunch = FAKE_LUNCHES.find((l) => rightName.includes(l.name))
      expect(leftLunch, `Round ${round + 1}: unrecognised left card: "${leftName}"`).toBeDefined()
      expect(rightLunch, `Round ${round + 1}: unrecognised right card: "${rightName}"`).toBeDefined()
      expect(leftName, `Round ${round + 1}: left and right cards are the same`).not.toBe(rightName)

      shownPairs.push({ left: leftName, right: rightName })

      // Vote "A wins"
      await page.locator('.vote-buttons .btn').nth(0).click()

      if (round < FAKE_PAIRS.length - 1) {
        // Wait for the transition to the next pair (bar fills in 1.5 s).
        // Check BOTH names because consecutive pairs may share a lunch on one side
        // (e.g. Pizza-Burger → Pizza-Tacos keeps "Pizza" on the left).
        await page.waitForFunction(
          ({ l, r }: { l: string; r: string }) => {
            const els = document.querySelectorAll('.lunch-card-name')
            const curL = els[0]?.textContent?.trim() ?? ''
            const curR = els[1]?.textContent?.trim() ?? ''
            return curL !== l || curR !== r
          },
          { l: leftName, r: rightName },
          { timeout: 5000 }
        )
      }
    }

    await expect(page.locator('.state-title')).toHaveText("You've seen them all!", {
      timeout: 8000,
    })
    await expect(page.locator('.state-desc')).toContainText('Check back later')

    // CTA button navigates to the leaderboard
    await page.locator('.state-center button').click()
    await expect(page).toHaveURL(/\/leaderboard/, { timeout: 3000 })

    // Verify no duplicate pairs were displayed
    const pairKeys = shownPairs.map(({ left, right }) => [left, right].sort().join('|'))
    const uniqueKeys = new Set(pairKeys)
    expect(
      uniqueKeys.size,
      `Expected ${FAKE_PAIRS.length} unique pairs but got ${uniqueKeys.size}: ${pairKeys.join(', ')}`
    ).toBe(FAKE_PAIRS.length)

    // Verify all 3 combinations appeared (order-independent)
    for (const [a, b] of FAKE_PAIRS) {
      const expectedKey = [a.name, b.name].sort().join('|')
      expect(
        uniqueKeys.has(expectedKey),
        `Pair "${a.name}" vs "${b.name}" was never shown`
      ).toBe(true)
    }
  })

  test('shows exhausted message immediately on page load when all pairs already seen', async ({ page }) => {
    await page.route('**/api/matchup**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/matchup/seen') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'exhausted' }),
      })
    })

    await page.goto('/')

    // Exhausted state must appear without any user interaction
    await expect(page.locator('.state-title')).toHaveText("You've seen them all!", { timeout: 8000 })
    await expect(page.locator('.state-desc')).toContainText('Check back later')

    // Vote arena must NOT be shown
    await expect(page.locator('.vote-arena')).not.toBeVisible()
  })
})
