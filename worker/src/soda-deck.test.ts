import { describe, expect, test } from 'vitest'
import { buildFeed, deckEvidence, type DeckDrink } from './soda-deck'
import { seededRandom } from './soda-order'

function drink(id: number, overrides: Partial<DeckDrink> = {}): DeckDrink {
  return { id, right_swipes: 0, left_swipes: 0, reporters: 0, ...overrides }
}

const rng = () => 0.42

describe('buildFeed', () => {
  test('returns every unswiped drink, with no deck size cap', () => {
    const drinks = Array.from({ length: 124 }, (_, i) => drink(i + 1))
    expect(buildFeed(drinks, new Set(), rng)).toHaveLength(124)
  })

  test('puts the least-evidence drinks first', () => {
    const drinks = [
      drink(1, { right_swipes: 10 }),
      drink(2, { reporters: 1 }),
      drink(3),
      drink(4, { left_swipes: 2 }),
    ]
    expect(buildFeed(drinks, new Set(), rng).map((d) => d.id)).toEqual([3, 4, 2, 1])
  })

  test('counts a report as five swipes of evidence', () => {
    expect(deckEvidence(drink(1, { right_swipes: 2, left_swipes: 1, reporters: 2 }))).toBe(13)
  })

  test('never includes a drink this voter already swiped', () => {
    const drinks = Array.from({ length: 30 }, (_, i) => drink(i + 1, { right_swipes: i }))
    const swiped = new Set([1, 2, 3, 10, 20, 30])
    const feed = buildFeed(drinks, swiped, rng)
    expect(feed).toHaveLength(24)
    expect(feed.some((d) => swiped.has(d.id))).toBe(false)
  })

  test('is empty once every drink is swiped (no wraparound)', () => {
    const drinks = [drink(1), drink(2)]
    expect(buildFeed(drinks, new Set([1, 2]), rng)).toEqual([])
  })

  test('the same seed gives the same tie order regardless of input order', () => {
    const drinks = Array.from({ length: 10 }, (_, i) => drink(i + 1))
    const a = buildFeed(drinks, new Set(), seededRandom('session-a')).map((d) => d.id)
    const b = buildFeed([...drinks].reverse(), new Set(), seededRandom('session-a')).map((d) => d.id)
    const c = buildFeed(drinks, new Set(), seededRandom('session-b')).map((d) => d.id)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
  })
})
