import { describe, expect, test } from 'vitest'
import { buildDeck, DECK_SIZE, deckEvidence, type DeckDrink } from './soda-deck'

function drink(id: number, overrides: Partial<DeckDrink> = {}): DeckDrink {
  return { id, right_swipes: 0, left_swipes: 0, reporters: 0, ...overrides }
}

const rng = () => 0.42

describe('buildDeck', () => {
  test('caps the deck at 20 cards', () => {
    const drinks = Array.from({ length: 50 }, (_, i) => drink(i + 1))
    expect(DECK_SIZE).toBe(20)
    expect(buildDeck(drinks, new Map(), DECK_SIZE, rng)).toHaveLength(20)
  })

  test('puts the least-evidence drinks first', () => {
    const drinks = [
      drink(1, { right_swipes: 10 }),
      drink(2, { reporters: 1 }),
      drink(3),
      drink(4, { left_swipes: 2 }),
    ]
    expect(buildDeck(drinks, new Map(), DECK_SIZE, rng).map((d) => d.id)).toEqual([3, 4, 2, 1])
  })

  test('counts a report as five swipes of evidence', () => {
    expect(deckEvidence(drink(1, { right_swipes: 2, left_swipes: 1, reporters: 2 }))).toBe(13)
  })

  test('never repeats a swiped drink while unswiped drinks remain', () => {
    const drinks = Array.from({ length: 30 }, (_, i) => drink(i + 1, { right_swipes: i }))
    const swiped = new Map(Array.from({ length: 15 }, (_, i) => [i + 1, '2026-11-16 12:00:00'] as [number, string]))
    const deck = buildDeck(drinks, swiped, DECK_SIZE, rng)
    expect(deck.slice(0, 15).every((d) => !swiped.has(d.id))).toBe(true)
    expect(deck.slice(15).every((d) => swiped.has(d.id))).toBe(true)
  })

  test('repeats oldest swipes first once the unswiped pool is exhausted', () => {
    const drinks = [drink(1), drink(2), drink(3)]
    const swiped = new Map<number, string>([
      [1, '2026-11-16 12:00:03'],
      [2, '2026-11-16 12:00:01'],
      [3, '2026-11-16 12:00:02'],
    ])
    expect(buildDeck(drinks, swiped, DECK_SIZE, rng).map((d) => d.id)).toEqual([2, 3, 1])
  })

  test('shuffles drinks with equal evidence', () => {
    const drinks = Array.from({ length: 10 }, (_, i) => drink(i + 1))
    const orders = new Set<string>()
    let seed = 1
    const lcg = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 5; i++) {
      orders.add(buildDeck(drinks, new Map(), DECK_SIZE, lcg).map((d) => d.id).join(','))
    }
    expect(orders.size).toBeGreaterThan(1)
  })
})
