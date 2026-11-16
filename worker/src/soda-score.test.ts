import { describe, expect, test } from 'vitest'
import {
  compareDrinks,
  hasData,
  hasOwnEvidence,
  ownEvidence,
  rankDrinks,
  rankForLeaderboard,
  scoreDrinks,
  SODA_BRAND_PRIOR_STRENGTH,
  SODA_MEAN_SHRINK,
  sodaAppeal,
  swipeKappa,
  type DrinkStats,
} from './soda-score'

let nextId = 1000

function drink(id: number, overrides: Partial<DrinkStats> = {}): DrinkStats {
  return {
    id,
    brand: `Brand ${id}`,
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

function brandMates(brand: string, count: number, likes: number, hates: number): DrinkStats[] {
  return Array.from({ length: count }, () => drink(nextId++, { brand, likes, hates, reporters: likes + hates }))
}

function scoreOf(drinks: DrinkStats[], id: number) {
  const scored = scoreDrinks(drinks).find((d) => d.id === id)
  if (!scored) throw new Error(`no drink ${id}`)
  return scored
}

describe('own evidence', () => {
  test('each report adds one to a or b', () => {
    expect(ownEvidence(drink(1, { likes: 3, hates: 1, reporters: 4 }))).toEqual({ a: 3, b: 1 })
  })

  test('five right swipes weigh one report, split 0.75 / 0.25', () => {
    expect(swipeKappa(5, 0)).toBeCloseTo(1)
    const e = ownEvidence(drink(1, { right_swipes: 5 }))
    expect(e.a).toBeCloseTo(0.75)
    expect(e.b).toBeCloseTo(0.25)
  })

  test('right-swipe weight caps at 3 pseudo-counts and fades as reports arrive', () => {
    expect(swipeKappa(15, 0)).toBeCloseTo(3)
    expect(swipeKappa(500, 0)).toBeCloseTo(3)
    expect(swipeKappa(15, 3)).toBeCloseTo(1.5)
    expect(swipeKappa(15, 27)).toBeCloseTo(0.3)
  })

  test('left swipes add no evidence', () => {
    expect(ownEvidence(drink(1, { right_swipes: 4, left_swipes: 50 })))
      .toEqual(ownEvidence(drink(1, { right_swipes: 4 })))
  })
})

describe('hierarchical brand prior', () => {
  test('with no data anywhere every drink is Beta(1, 1)', () => {
    const scored = scoreDrinks([drink(1), drink(2, { brand: 'Brand 1' }), drink(3, { type: 'seltzer' })])
    for (const d of scored) {
      expect(d.alpha).toBeCloseTo(1)
      expect(d.beta).toBeCloseTo(1)
      expect(d.score).toBeCloseTo(0.5)
    }
  })

  test('a single-drink brand gets exactly the type-mean prior (leave-one-out)', () => {
    const drinks = [
      drink(1, { brand: 'Solo', likes: 3, reporters: 3 }),
      ...brandMates('Other', 3, 2, 0),
      drink(2, { type: 'seltzer', hates: 5, reporters: 5 }),
    ]
    const solo = scoreOf(drinks, 1)
    // Σ_soda a = 3 + 3·2 = 9, Σ_soda (a+b) = 9. The seltzer does not count.
    const typeMean = (9 + SODA_MEAN_SHRINK * 0.5) / (9 + SODA_MEAN_SHRINK)
    expect(solo.type_mean).toBeCloseTo(typeMean)
    expect(solo.prior_mean).toBeCloseTo(typeMean)
    expect(solo.alpha).toBeCloseTo(SODA_BRAND_PRIOR_STRENGTH * typeMean + 3)
    expect(solo.beta).toBeCloseTo(SODA_BRAND_PRIOR_STRENGTH * (1 - typeMean))
  })

  test('the brand prior leaves the drink itself out', () => {
    const drinks = [drink(1, { brand: 'B', likes: 4, reporters: 4 }), drink(2, { brand: 'B' })]
    const first = scoreOf(drinks, 1)
    // Drink 1's prior only sees drink 2, which has no data, so it equals the type mean.
    expect(first.prior_mean).toBeCloseTo(first.type_mean)
    // Drink 2's prior sees drink 1's four likes.
    expect(scoreOf(drinks, 2).prior_mean).toBeGreaterThan(first.type_mean)
  })

  test('a no-data drink from a hated brand scores below 0.5 and below loved or unknown brands', () => {
    const hatedNew = drink(1, { brand: 'Hated' })
    const lovedNew = drink(2, { brand: 'Loved' })
    const unknownNew = drink(3, { brand: 'Unknown' })
    const drinks = [
      hatedNew, lovedNew, unknownNew,
      ...brandMates('Hated', 3, 0, 4),
      ...brandMates('Loved', 3, 4, 0),
      drink(4, { brand: 'Unknown' }),
    ]
    const hated = scoreOf(drinks, 1).score
    const loved = scoreOf(drinks, 2).score
    const unknown = scoreOf(drinks, 3).score

    expect(hated).toBeLessThan(0.5)
    expect(hated).toBeLessThan(unknown)
    expect(hated).toBeLessThan(loved)
    expect(loved).toBeGreaterThan(unknown)
  })

  test('lots of own evidence barely moves when brand-mates are bad', () => {
    // Same bad drinks in both worlds, so the type mean is identical; only brand membership changes.
    const star = { brand: 'Star', likes: 10, reporters: 10 }
    const solo = scoreOf([drink(1, star), ...brandMates('Elsewhere', 4, 0, 5)], 1)
    const withBadMates = scoreOf([drink(1, star), ...brandMates('Star', 4, 0, 5)], 1)

    const priorShift = solo.prior_mean - withBadMates.prior_mean
    const scoreShift = solo.score - withBadMates.score
    expect(priorShift).toBeGreaterThan(0.25)
    expect(scoreShift).toBeGreaterThan(0)
    expect(scoreShift).toBeLessThan(0.06)
    expect(scoreShift).toBeLessThan(priorShift / 4)
    expect(withBadMates.score).toBeGreaterThan(0.8)
  })

  test('brands are keyed by the catalog brand string as-is', () => {
    const drinks = [drink(1, { brand: 'poppi' }), ...brandMates('Poppi', 3, 0, 4)]
    expect(scoreOf(drinks, 1).prior_mean).toBeCloseTo(scoreOf(drinks, 1).type_mean)
  })
})

describe('ranking', () => {
  test('left swipes lower appeal only', () => {
    expect(sodaAppeal(drink(1))).toBe(0.5)
    expect(sodaAppeal(drink(1, { right_swipes: 4, left_swipes: 0 }))).toBeCloseTo(5 / 6)
    expect(sodaAppeal(drink(1, { right_swipes: 4, left_swipes: 6 }))).toBeCloseTo(5 / 12)
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
    const [a, b] = scoreDrinks([drink(2, { flavor: 'Apple', brand: 'X' }), drink(1, { flavor: 'Banana', brand: 'X' })])
    expect(compareDrinks(a, b)).toBeLessThan(0)
    const [c, d] = scoreDrinks([drink(1, { flavor: 'Same', brand: 'X' }), drink(2, { flavor: 'Same', brand: 'X' })])
    expect(compareDrinks(c, d)).toBeLessThan(0)
  })

  test('hasData is true for any swipe or report', () => {
    expect(hasData(drink(1))).toBe(false)
    expect(hasData(drink(1, { left_swipes: 1 }))).toBe(true)
    expect(hasData(drink(1, { hates: 1, reporters: 1 }))).toBe(true)
  })
})

describe('public leaderboard order', () => {
  test('drinks with their own evidence rank above drinks without, even from a loved brand', () => {
    const lovedUntried = drink(1, { brand: 'Loved' })
    const modestLiked = drink(2, { brand: 'Plain', likes: 1, hates: 1, reporters: 2 })
    const swipedRight = drink(3, { brand: 'Plain', right_swipes: 1 })
    const drinks = [lovedUntried, modestLiked, swipedRight, ...brandMates('Loved', 3, 5, 0)]

    // Posterior alone would put the untried Loved drink above the modest one.
    const byPosterior = rankDrinks(drinks).map((d) => d.id)
    expect(byPosterior.indexOf(1)).toBeLessThan(byPosterior.indexOf(2))

    const board = rankForLeaderboard(drinks).map((d) => d.id)
    expect(board.indexOf(2)).toBeLessThan(board.indexOf(1))
    expect(board.indexOf(3)).toBeLessThan(board.indexOf(1))
    expect(board[board.length - 1]).toBe(1)
  })

  test('a left-swipe-only drink from a loved brand ranks below a drink with modest real evidence', () => {
    const lovedLeftOnly = drink(1, { brand: 'Loved', left_swipes: 1 })
    const modestLiked = drink(2, { brand: 'Plain', likes: 1, hates: 1, reporters: 2 })
    const drinks = [lovedLeftOnly, modestLiked, ...brandMates('Loved', 3, 5, 0)]

    const scored = scoreDrinks(drinks)
    expect(scored.find((d) => d.id === 1)!.score).toBeGreaterThan(scored.find((d) => d.id === 2)!.score)
    expect(hasData(lovedLeftOnly)).toBe(true)

    const board = rankForLeaderboard(drinks).map((d) => d.id)
    expect(board.indexOf(2)).toBeLessThan(board.indexOf(1))
  })

  test('left-swipe-only and untried drinks share the no-evidence group, in posterior order', () => {
    const lovedUntried = drink(1, { brand: 'Loved' })
    const plainLeftOnly = drink(2, { brand: 'Plain', left_swipes: 3 })
    const plainUntried = drink(3, { brand: 'Plain' })
    const drinks = [plainLeftOnly, plainUntried, lovedUntried, ...brandMates('Loved', 2, 4, 0)]

    const noEvidence = rankForLeaderboard(drinks).filter((d) => !hasOwnEvidence(d)).map((d) => d.id)
    // Loved brand prior first; then the two Plain drinks tie on score and appeal breaks it.
    expect(noEvidence).toEqual([1, 3, 2])
  })

  test('the brand prior still orders untried drinks among themselves', () => {
    const drinks = [
      drink(1, { brand: 'Hated' }),
      drink(2, { brand: 'Loved' }),
      drink(3, { brand: 'Unknown' }),
      ...brandMates('Hated', 2, 0, 4),
      ...brandMates('Loved', 2, 4, 0),
    ]
    const untried = rankForLeaderboard(drinks).filter((d) => !hasData(d)).map((d) => d.id)
    expect(untried).toEqual([2, 3, 1])
  })
})
