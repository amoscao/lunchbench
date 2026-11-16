import { describe, expect, test } from 'vitest'
import {
  compareDrinks,
  hasData,
  posterior,
  rankDrinks,
  sodaAppeal,
  sodaScore,
  swipeKappa,
  type DrinkStats,
} from './soda-score'

function drink(id: number, overrides: Partial<DrinkStats> = {}): DrinkStats {
  return {
    id,
    brand: 'Brand',
    flavor: `Flavor ${id}`,
    type: 'soda',
    image_key: null,
    right_swipes: 0,
    left_swipes: 0,
    likes: 0,
    hates: 0,
    reporters: 0,
    ...overrides,
  }
}

describe('soda scoring', () => {
  test('no data is the Beta(1, 1) prior', () => {
    expect(posterior(drink(1))).toEqual({ alpha: 1, beta: 1 })
    expect(sodaScore(drink(1))).toBe(0.5)
  })

  test('each report adds one to alpha or beta', () => {
    const p = posterior(drink(1, { likes: 3, hates: 1, reporters: 4 }))
    expect(p).toEqual({ alpha: 4, beta: 2 })
    expect(sodaScore(drink(1, { likes: 3, hates: 1, reporters: 4 }))).toBeCloseTo(4 / 6)
  })

  test('five right swipes weigh one report, split 0.75 / 0.25', () => {
    expect(swipeKappa(5, 0)).toBeCloseTo(1)
    const p = posterior(drink(1, { right_swipes: 5 }))
    expect(p.alpha).toBeCloseTo(1.75)
    expect(p.beta).toBeCloseTo(1.25)
  })

  test('right-swipe weight caps at 3 pseudo-counts', () => {
    expect(swipeKappa(15, 0)).toBeCloseTo(3)
    expect(swipeKappa(500, 0)).toBeCloseTo(3)
  })

  test('right-swipe weight fades as reports arrive', () => {
    expect(swipeKappa(15, 3)).toBeCloseTo(1.5)
    expect(swipeKappa(15, 27)).toBeCloseTo(0.3)
  })

  test('left swipes do not change the score', () => {
    expect(sodaScore(drink(1, { right_swipes: 4, left_swipes: 50 })))
      .toBe(sodaScore(drink(1, { right_swipes: 4 })))
  })

  test('left swipes lower appeal', () => {
    expect(sodaAppeal(drink(1))).toBe(0.5)
    expect(sodaAppeal(drink(1, { right_swipes: 4, left_swipes: 0 }))).toBeCloseTo(5 / 6)
    expect(sodaAppeal(drink(1, { right_swipes: 4, left_swipes: 6 }))).toBeCloseTo(5 / 12)
  })

  test('one hate outweighs many right swipes', () => {
    const swiped = drink(1, { right_swipes: 100 })
    const hatedByReporters = drink(2, { right_swipes: 100, hates: 3, reporters: 3 })
    expect(sodaScore(hatedByReporters)).toBeLessThan(sodaScore(swiped))
  })

  test('ranks by posterior mean, then appeal, then name', () => {
    const liked = drink(1, { likes: 2, reporters: 2 })
    const swipedOnly = drink(2, { right_swipes: 10 })
    const sameScoreMoreLeft = drink(3, { flavor: 'A', left_swipes: 9 })
    const sameScoreFewerLeft = drink(4, { flavor: 'B', left_swipes: 1 })
    const hated = drink(5, { hates: 1, reporters: 1 })

    const ranked = rankDrinks([hated, sameScoreMoreLeft, swipedOnly, sameScoreFewerLeft, liked])
    expect(ranked.map((d) => d.id)).toEqual([1, 2, 4, 3, 5])
  })

  test('ties with equal appeal fall back to name, then id', () => {
    expect(compareDrinks(drink(2, { flavor: 'Apple' }), drink(1, { flavor: 'Banana' }))).toBeLessThan(0)
    expect(compareDrinks(drink(1, { flavor: 'Same' }), drink(2, { flavor: 'Same' }))).toBeLessThan(0)
  })

  test('hasData is true for any swipe or report', () => {
    expect(hasData(drink(1))).toBe(false)
    expect(hasData(drink(1, { left_swipes: 1 }))).toBe(true)
    expect(hasData(drink(1, { hates: 1, reporters: 1 }))).toBe(true)
  })
})
