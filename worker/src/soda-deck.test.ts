import { describe, expect, test } from 'vitest'
import { buildFeed, deckEvidence, sessionTieKey, type DeckDrink } from './soda-deck'
import { seededRandom } from './soda-order'

function drink(id: number, overrides: Partial<DeckDrink> = {}): DeckDrink {
  return { id, right_swipes: 0, left_swipes: 0, reporters: 0, ...overrides }
}

const byId = (id: number) => id

describe('buildFeed', () => {
  test('returns every unswiped drink, with no deck size cap', () => {
    const drinks = Array.from({ length: 124 }, (_, i) => drink(i + 1))
    expect(buildFeed(drinks, new Set(), byId)).toHaveLength(124)
  })

  test('puts the least-evidence drinks first', () => {
    const drinks = [
      drink(1, { right_swipes: 10 }),
      drink(2, { reporters: 1 }),
      drink(3),
      drink(4, { left_swipes: 2 }),
    ]
    expect(buildFeed(drinks, new Set(), byId).map((d) => d.id)).toEqual([3, 4, 2, 1])
  })

  test('counts a report as five swipes of evidence', () => {
    expect(deckEvidence(drink(1, { right_swipes: 2, left_swipes: 1, reporters: 2 }))).toBe(13)
  })

  test('never includes a drink this voter already swiped', () => {
    const drinks = Array.from({ length: 30 }, (_, i) => drink(i + 1, { right_swipes: i }))
    const swiped = new Set([1, 2, 3, 10, 20, 30])
    const feed = buildFeed(drinks, swiped, byId)
    expect(feed).toHaveLength(24)
    expect(feed.some((d) => swiped.has(d.id))).toBe(false)
  })

  test('is empty once every drink is swiped (no wraparound)', () => {
    expect(buildFeed([drink(1), drink(2)], new Set([1, 2]), byId)).toEqual([])
  })

  test('ties follow a per-session key that does not depend on input order', () => {
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

  test('tied drinks are spread evenly across voters (no drink is everyone\'s first)', () => {
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
