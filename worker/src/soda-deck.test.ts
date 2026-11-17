import { describe, expect, test } from 'vitest'
import { buildFeed, DECK_BIAS_POWER, deckWeight, sessionTieKey, type DeckDrink } from './soda-deck'
import { seededRandom } from './soda-order'

function drink(id: number, overrides: Partial<DeckDrink> = {}): DeckDrink {
  return { id, score: 0.5, ...overrides }
}

const byId = (id: number) => id

describe('buildFeed', () => {
  test('returns every unswiped drink, with no deck size cap', () => {
    const drinks = Array.from({ length: 124 }, (_, i) => drink(i + 1))
    expect(buildFeed(drinks, new Set(), byId)).toHaveLength(124)
  })

  test('weights a drink by its posterior odds to the power DECK_BIAS_POWER', () => {
    expect(DECK_BIAS_POWER).toBe(2)
    expect(deckWeight(0.5)).toBeCloseTo(1)
    expect(deckWeight(0.8)).toBeCloseTo(16)
    expect(deckWeight(0.2)).toBeCloseTo(1 / 16)
    expect(Number.isFinite(deckWeight(1))).toBe(true)
    expect(deckWeight(0)).toBeGreaterThan(0)
  })

  test('liked drinks come early far more often, disliked ones late, across voters', () => {
    // 10 liked (0.8), 100 unrated (0.5), 10 disliked (0.25).
    const drinks = [
      ...Array.from({ length: 10 }, (_, i) => drink(i + 1, { score: 0.8 })),
      ...Array.from({ length: 100 }, (_, i) => drink(i + 11, { score: 0.5 })),
      ...Array.from({ length: 10 }, (_, i) => drink(i + 111, { score: 0.25 })),
    ]
    const kind = (id: number) => (id <= 10 ? 'liked' : id <= 110 ? 'unrated' : 'disliked')
    const firstTen = { liked: 0, unrated: 0, disliked: 0 }
    const sessions = 2000
    for (let i = 0; i < sessions; i++) {
      const feed = buildFeed(drinks, new Set(), sessionTieKey(`voter-${i}`, seededRandom))
      for (const d of feed.slice(0, 10)) firstTen[kind(d.id)] += 1
    }
    // Uniform would put 1 of 12 liked drinks in a voter's first ten (10/120 * 10 per voter).
    expect(firstTen.liked / sessions).toBeGreaterThan(4)
    expect(firstTen.disliked / sessions).toBeLessThan(0.1)
    expect(firstTen.unrated).toBeGreaterThan(0)
  })

  test('with no ratings at all the order is a uniform shuffle', () => {
    const drinks = Array.from({ length: 50 }, (_, i) => drink(i + 1))
    const firsts = new Set<number>()
    for (let i = 0; i < 500; i++) firsts.add(buildFeed(drinks, new Set(), sessionTieKey(`v${i}`, seededRandom))[0].id)
    expect(firsts.size).toBeGreaterThan(40)
  })

  test('a disliked drink is still reachable: it stays in the feed', () => {
    const drinks = [drink(1, { score: 0.05 }), drink(2, { score: 0.9 }), drink(3)]
    expect(buildFeed(drinks, new Set(), byId).map((d) => d.id).sort()).toEqual([1, 2, 3])
  })

  test('never includes a drink this voter already swiped', () => {
    const drinks = Array.from({ length: 30 }, (_, i) => drink(i + 1, { score: (i + 1) / 31 }))
    const swiped = new Set([1, 2, 3, 10, 20, 30])
    const feed = buildFeed(drinks, swiped, byId)
    expect(feed).toHaveLength(24)
    expect(feed.some((d) => swiped.has(d.id))).toBe(false)
  })

  test('is empty once every drink is swiped (no wraparound)', () => {
    expect(buildFeed([drink(1), drink(2)], new Set([1, 2]), byId)).toEqual([])
  })

  test('order follows a per-session key that does not depend on input order', () => {
    const drinks = Array.from({ length: 12 }, (_, i) => drink(i + 1))
    const a = buildFeed(drinks, new Set(), sessionTieKey('session-a', seededRandom)).map((d) => d.id)
    const reversed = buildFeed([...drinks].reverse(), new Set(), sessionTieKey('session-a', seededRandom)).map((d) => d.id)
    const other = buildFeed(drinks, new Set(), sessionTieKey('session-b', seededRandom)).map((d) => d.id)
    expect(reversed).toEqual(a)
    expect(other).not.toEqual(a)
  })

  test('the remaining drinks keep their relative order after swipes', () => {
    const drinks = Array.from({ length: 20 }, (_, i) => drink(i + 1))
    const key = sessionTieKey('session-a', seededRandom)
    const before = buildFeed(drinks, new Set(), key).map((d) => d.id)
    const swiped = new Set([before[0], before[3], before[7], before[12]])
    const after = buildFeed(drinks, swiped, key).map((d) => d.id)
    expect(after).toEqual(before.filter((id) => !swiped.has(id)))
  })

  test('equal-score drinks are spread evenly across voters (no drink is everyone\'s first)', () => {
    const drinks = Array.from({ length: 124 }, (_, i) => drink(i + 1))
    const sessions = 5000
    const rng = seededRandom('uuid-generator')
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
    const firstCount = new Map<number, number>()
    const topFiveCount = new Map<number, number>()
    for (let i = 0; i < sessions; i++) {
      const session = `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
      const feed = buildFeed(drinks, new Set(), sessionTieKey(session, seededRandom))
      firstCount.set(feed[0].id, (firstCount.get(feed[0].id) ?? 0) + 1)
      for (const d of feed.slice(0, 5)) topFiveCount.set(d.id, (topFiveCount.get(d.id) ?? 0) + 1)
    }
    const uniformFirst = sessions / drinks.length
    const uniformTopFive = (sessions * 5) / drinks.length
    for (const d of drinks) {
      expect(firstCount.get(d.id) ?? 0, `first ${d.id}`).toBeLessThanOrEqual(2 * uniformFirst)
      expect(topFiveCount.get(d.id) ?? 0, `top five ${d.id}`).toBeGreaterThanOrEqual(0.5 * uniformTopFive)
    }
  })
})
