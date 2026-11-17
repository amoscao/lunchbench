import { test, expect, type Page } from '@playwright/test'
import { waitForMatchup } from './helpers'

// Fake lunches so the served pairs are fully scripted.
const LUNCHES = {
  a: { id: 9101, name: 'Seen Pair Alpha' },
  b: { id: 9102, name: 'Seen Pair Bravo' },
  c: { id: 9103, name: 'Seen Pair Charlie' },
  d: { id: 9104, name: 'Seen Pair Delta' },
  e: { id: 9105, name: 'Seen Pair Echo' },
  f: { id: 9106, name: 'Seen Pair Foxtrot' },
} as const

type FakeLunch = (typeof LUNCHES)[keyof typeof LUNCHES]

function makeLunchJson(l: FakeLunch) {
  return {
    id: l.id,
    name: l.name,
    description: null,
    image_key: null,
    image_url: null,
    is_vegan: 0,
    is_legacy: 0,
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

function makeMatchupJson(left: FakeLunch, right: FakeLunch, token: string) {
  const r = { rating: 1500, conservative_rating: 1350, rank: 1 }
  return {
    status: 'ok',
    matchup_token: token,
    left: makeLunchJson(left),
    right: makeLunchJson(right),
    projected: {
      left_win: { left: r, right: { ...r, rank: 2 } },
      right_win: { left: { ...r, rank: 2 }, right: r },
      tie: { left: r, right: r },
    },
  }
}

// Serves GET /api/matchup from `next(callNumber)` and records seen acks without hitting the API.
async function scriptMatchups(
  page: Page,
  next: (call: number) => object
): Promise<{ calls: () => number; acks: string[]; callsAtFirstAck: () => number | null }> {
  let calls = 0
  let callsAtFirstAck: number | null = null
  const acks: string[] = []
  await page.route('**/api/matchup**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/matchup/seen') {
      callsAtFirstAck ??= calls
      acks.push((request.postDataJSON() as { token: string }).token)
      await route.fulfill({ json: { ok: true } })
      return
    }
    if (url.pathname !== '/api/matchup') {
      await route.continue()
      return
    }
    calls++
    await route.fulfill({ json: next(calls) })
  })
  return { calls: () => calls, acks, callsAtFirstAck: () => callsAtFirstAck }
}

async function markPairSeenInBrowser(page: Page, leftId: number, rightId: number): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem('lb_seen_pairs', JSON.stringify([key]))
  }, `${Math.min(leftId, rightId)}-${Math.max(leftId, rightId)}`)
}

async function expectPair(page: Page, left: FakeLunch, right: FakeLunch): Promise<void> {
  const names = page.locator('.vote-arena .lunch-card-name')
  await expect(names.nth(0)).toContainText(left.name)
  await expect(names.nth(1)).toContainText(right.name)
}

test.describe('Client-side seen pair retry', () => {
  test('replaces a pair already seen in this browser on initial load and prefetch', async ({ page }) => {
    const { a, b, c, d, e, f } = LUNCHES
    await markPairSeenInBrowser(page, a.id, b.id)
    // 1: seen A-B, 2: fresh C-D (rendered), 3: prefetch gets seen A-B, 4: fresh E-F.
    const script = [
      makeMatchupJson(b, a, 'ba'),
      makeMatchupJson(c, d, 'cd'),
      makeMatchupJson(a, b, 'ab'),
      makeMatchupJson(e, f, 'ef'),
    ]
    const server = await scriptMatchups(page, (call) => script[call - 1] ?? { status: 'exhausted' })

    await page.goto('/')
    await waitForMatchup(page)
    await expectPair(page, c, d)
    await expect.poll(() => server.acks).toEqual(['cd'])
    expect(server.callsAtFirstAck()).toBe(2)
    await expect.poll(() => server.calls()).toBe(4)

    // Skip uses the prefetched result, which retried past the seen pair.
    await page.locator('.vote-buttons .btn').nth(3).click()
    await expectPair(page, e, f)
    await expect.poll(() => server.acks).toEqual(['cd', 'ef'])
    await expect.poll(() => server.calls()).toBe(5)

    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('retries once and shows the seen pair when the server keeps returning it', async ({ page }) => {
    const { a, b } = LUNCHES
    await markPairSeenInBrowser(page, a.id, b.id)
    const server = await scriptMatchups(page, (call) => makeMatchupJson(a, b, `ab-${call}`))

    await page.goto('/')
    await waitForMatchup(page)
    await expectPair(page, a, b)
    // Initial load: original + one retry, the retry result renders and is acked once.
    await expect.poll(() => server.acks).toEqual(['ab-2'])
    expect(server.callsAtFirstAck()).toBe(2)
    // Prefetch: original + one retry, then no more requests.
    await expect.poll(() => server.calls()).toBe(4)
    // Deliberate quiet window: a retry loop would exceed 4 calls within milliseconds.
    await page.waitForTimeout(1000)
    expect(server.calls()).toBe(4)
    expect(server.acks).toEqual(['ab-2'])

    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
