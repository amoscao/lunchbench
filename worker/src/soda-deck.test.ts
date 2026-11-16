import { describe, expect, test } from 'vitest'
import { buildFeed, deckEvidence, sessionTieKey, type DeckDrink } from './soda-deck'
import { hashSeed } from './soda-order'

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
    const a = buildFeed(drinks, new Set(), sessionTieKey('session-a', hashSeed)).map((d) => d.id)
    const reversed = buildFeed([...drinks].reverse(), new Set(), sessionTieKey('session-a', hashSeed)).map((d) => d.id)
    const other = buildFeed(drinks, new Set(), sessionTieKey('session-b', hashSeed)).map((d) => d.id)
    expect(reversed).toEqual(a)
    expect(other).not.toEqual(a)
  })

  test('the remaining drinks keep their relative order after swipes', () => {
    const drinks = Array.from({ length: 20 }, (_, i) => drink(i + 1))
    const key = sessionTieKey('session-a', hashSeed)
    const before = buildFeed(drinks, new Set(), key).map((d) => d.id)
    const swiped = new Set([before[0], before[3], before[7], before[12]])
    const after = buildFeed(drinks, swiped, key).map((d) => d.id)
    expect(after).toEqual(before.filter((id) => !swiped.has(id)))
  })
})
