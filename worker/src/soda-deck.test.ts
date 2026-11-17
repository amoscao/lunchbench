import { describe, expect, test } from 'vitest'
import {
  buildFeed,
  DECK_MAX_WEIGHT,
  DECK_MIN_WEIGHT,
  deckWeight,
  sessionTieKey,
  type DeckDrink,
} from './soda-deck'
import { seededRandom } from './soda-order'
import { scoreDrinks, type DrinkStats, type SodaType } from './soda-score'

function drink(id: number, overrides: Partial<DeckDrink> = {}): DeckDrink {
  return { id, prior_mean: 0.5, type_mean: 0.5, right_swipes: 0, likes: 0, hates: 0, reporters: 0, ...overrides }
}

/** A fixed key strictly inside (0, 1), so tests exercise real sampling rather than the clamp. */
const fixedKey = (id: number) => (id % 997) / 1000 + 0.0005

function voterKey(i: number) {
  return sessionTieKey(`voter-${i}`, seededRandom)
}

/** Rough shape of the real catalog: many brands, several flavors each, sodas and seltzers. */
function catalog(): DrinkStats[] {
  const brands: Array<[string, SodaType, number]> = [
    ['Pepsi', 'soda', 8], ['Coca-Cola', 'soda', 8], ['poppi', 'soda', 12], ['Great Value', 'soda', 10],
    ['Mountain Dew', 'soda', 8], ['Zevia', 'soda', 8], ['Canada Dry', 'soda', 6], ['Sprite', 'soda', 4],
    ['LaCroix', 'seltzer', 10], ['bubly', 'seltzer', 8], ['Polar', 'seltzer', 8], ['Waterloo', 'seltzer', 6],
  ]
  const drinks: DrinkStats[] = []
  for (const [brand, type, count] of brands) {
    for (let i = 0; i < count; i++) {
      drinks.push({
        id: drinks.length + 1, brand, flavor: `Flavor ${i}`, type, image_key: null,
        right_swipes: 0, left_swipes: 0, likes: 0, hates: 0, reporters: 0,
      })
    }
  }
  return drinks
}

function withReports(drinks: DrinkStats[], brand: string, flavors: number, likes: number, hates: number): DrinkStats[] {
  let left = flavors
  return drinks.map((d) => {
    if (d.brand !== brand || left === 0) return d
    left -= 1
    return { ...d, likes, hates, reporters: likes + hates }
  })
}

/** Average count, per voter, of drinks matching `pick` among the first `n` of the feed. */
function shareOfFirst(drinks: DrinkStats[], pick: (d: DrinkStats) => boolean, n = 10, voters = 2000): number {
  const scored = scoreDrinks(drinks)
  let total = 0
  for (let i = 0; i < voters; i++) {
    total += buildFeed(scored, new Set(), voterKey(i)).slice(0, n).filter(pick).length
  }
  return total / voters
}

describe('deckWeight', () => {
  test('is 1 for an untried drink of a brand at its type mean', () => {
    expect(deckWeight(drink(1))).toBeCloseTo(1)
    expect(deckWeight(drink(1, { prior_mean: 0.8, type_mean: 0.8 }))).toBeCloseTo(1)
  })

  test('brand factor: odds of the brand prior over odds of the type mean', () => {
    // odds 0.75 / odds 0.6 = 3 / 1.5 = 2.
    expect(deckWeight(drink(1, { prior_mean: 0.75, type_mean: 0.6 }))).toBeCloseTo(2)
    expect(deckWeight(drink(1, { prior_mean: 0.6, type_mean: 0.75 }))).toBeCloseTo(1 / 2)
  })

  test('own factor: ((1 + a)/(1 + b))^2 from the drink\'s own reports', () => {
    expect(deckWeight(drink(1, { likes: 1, reporters: 1 }))).toBeCloseTo(4)
    expect(deckWeight(drink(1, { hates: 1, reporters: 1 }))).toBeCloseTo(1 / 4)
    expect(deckWeight(drink(1, { likes: 1, hates: 1, reporters: 2 }))).toBeCloseTo(1)
  })

  test('is capped to [DECK_MIN_WEIGHT, DECK_MAX_WEIGHT]', () => {
    expect(deckWeight(drink(1, { likes: 9, reporters: 9 }))).toBe(DECK_MAX_WEIGHT)
    expect(deckWeight(drink(1, { hates: 9, reporters: 9 }))).toBe(DECK_MIN_WEIGHT)
    expect(deckWeight(drink(1, { prior_mean: 1, type_mean: 0 }))).toBe(DECK_MAX_WEIGHT)
  })

  test.each([
    ['an office that mostly reports likes (type mean > 0.75)', 'Zevia', (d: DrinkStats[]) => withReports(withReports(d, 'Coca-Cola', 8, 2, 0), 'Great Value', 4, 2, 0)],
    ['a loved brand', 'poppi', (d: DrinkStats[]) => withReports(d, 'poppi', 4, 2, 0)],
    ['a hated brand', 'Pepsi', (d: DrinkStats[]) => withReports(d, 'Pepsi', 3, 0, 1)],
  ])('never falls as right swipes grow, in %s', (_, brand, setup) => {
    const base = setup(catalog())
    const target = base.find((d) => d.brand === brand && d.reporters === 0)!
    let previous = 0
    for (const right of [0, 1, 2, 5, 10, 15, 30]) {
      const drinks = base.map((d) => (d.id === target.id ? { ...d, right_swipes: right } : d))
      const weight = deckWeight(scoreDrinks(drinks).find((d) => d.id === target.id)!)
      expect(weight, `${right} right swipes`).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = weight
    }
    expect(previous).toBeGreaterThan(deckWeight(scoreDrinks(base).find((d) => d.id === target.id)!))
  })

  test('a like raises and a hate lowers the weight, wherever the type mean sits', () => {
    const office = withReports(withReports(catalog(), 'Coca-Cola', 8, 2, 0), 'Great Value', 4, 2, 0)
    const target = office.find((d) => d.brand === 'Zevia')!
    const weightWith = (likes: number, hates: number) => {
      const drinks = office.map((d) => (d.id === target.id ? { ...d, likes, hates, reporters: likes + hates } : d))
      return deckWeight(scoreDrinks(drinks).find((d) => d.id === target.id)!)
    }
    expect(weightWith(1, 0)).toBeGreaterThan(weightWith(0, 0))
    expect(weightWith(0, 1)).toBeLessThan(weightWith(0, 0))
  })
})

describe('buildFeed', () => {
  test('returns every unswiped drink, with no deck size cap', () => {
    const drinks = Array.from({ length: 124 }, (_, i) => drink(i + 1))
    expect(buildFeed(drinks, new Set(), fixedKey)).toHaveLength(124)
  })

  test('never includes a drink this voter already swiped', () => {
    const drinks = Array.from({ length: 30 }, (_, i) => drink(i + 1, { right_swipes: i }))
    const swiped = new Set([1, 2, 3, 10, 20, 30])
    const feed = buildFeed(drinks, swiped, fixedKey)
    expect(feed).toHaveLength(24)
    expect(feed.some((d) => swiped.has(d.id))).toBe(false)
  })

  test('is empty once every drink is swiped (no wraparound)', () => {
    expect(buildFeed([drink(1), drink(2)], new Set([1, 2]), fixedKey)).toEqual([])
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

  test('equal-weight drinks are spread evenly across voters (no drink is everyone\'s first)', () => {
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

describe('buildFeed on scored catalogs', () => {
  const isSeltzer = (d: DrinkStats) => d.type === 'seltzer'

  test('with no ratings at all every weight is 1 and the order is a uniform shuffle', () => {
    const scored = scoreDrinks(catalog())
    for (const d of scored) expect(deckWeight(d)).toBeCloseTo(1)
    const expected = (10 * catalog().filter(isSeltzer).length) / catalog().length
    expect(shareOfFirst(catalog(), isSeltzer)).toBeCloseTo(expected, 0)
  })

  test('hates on one brand do not reshuffle the other brands or the other type', () => {
    const base = shareOfFirst(catalog(), isSeltzer)
    const pepsiHated = withReports(catalog(), 'Pepsi', 5, 0, 2)
    const after = shareOfFirst(pepsiHated, isSeltzer)
    expect(after / base).toBeGreaterThan(0.75)
    expect(after / base).toBeLessThan(1.4)
  })

  test('likes on one brand do not push the other type out of the feed', () => {
    const base = shareOfFirst(catalog(), isSeltzer)
    const poppiLiked = withReports(catalog(), 'poppi', 4, 2, 0)
    expect(shareOfFirst(poppiLiked, isSeltzer) / base).toBeGreaterThan(0.6)
  })

  test('liked drinks come earliest; untried drinks of the same brand next; other brands after', () => {
    const drinks = withReports(catalog(), 'poppi', 4, 2, 0)
    const liked = (d: DrinkStats) => d.brand === 'poppi' && d.reporters > 0
    const untriedPoppi = (d: DrinkStats) => d.brand === 'poppi' && d.reporters === 0
    const other = (d: DrinkStats) => d.brand !== 'poppi'
    const perDrink = (pick: (d: DrinkStats) => boolean) => shareOfFirst(drinks, pick) / drinks.filter(pick).length
    expect(perDrink(liked)).toBeGreaterThan(perDrink(untriedPoppi))
    expect(perDrink(untriedPoppi)).toBeGreaterThan(perDrink(other))
  })

  test('a hated drink comes late but is not buried: some voters still see it early', () => {
    const drinks = withReports(catalog(), 'Pepsi', 5, 0, 2)
    const hated = (d: DrinkStats) => d.brand === 'Pepsi' && d.reporters > 0
    const untriedPepsi = (d: DrinkStats) => d.brand === 'Pepsi' && d.reporters === 0
    const neutral = (d: DrinkStats) => d.brand === 'Coca-Cola'
    const perDrink = (pick: (d: DrinkStats) => boolean) => shareOfFirst(drinks, pick, 20) / drinks.filter(pick).length
    expect(perDrink(hated)).toBeLessThan(perDrink(neutral) / 3)
    // A drink in a voter's first 20 for at least 1% of voters is reachable in practice.
    expect(perDrink(hated)).toBeGreaterThan(0.01)
    expect(perDrink(untriedPepsi)).toBeLessThan(perDrink(neutral))
    expect(perDrink(untriedPepsi)).toBeGreaterThan(perDrink(hated))
  })
})
