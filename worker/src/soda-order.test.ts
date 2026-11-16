import { describe, expect, test } from 'vitest'
import {
  addDays,
  buildOrderList,
  orderParams,
  rankForWeek,
  sampleBeta,
  seededRandom,
  weekStartFor,
  type OrderItem,
} from './soda-order'
import { rankDrinks, type DrinkStats, type SodaType } from './soda-score'

function drink(id: number, type: SodaType, overrides: Partial<DrinkStats> = {}): DrinkStats {
  return {
    id,
    brand: type === 'soda' ? 'Soda' : 'Seltzer',
    flavor: String(id).padStart(3, '0'),
    type,
    image_key: `images/${id}.jpg`,
    right_swipes: 0,
    left_swipes: 0,
    likes: 0,
    hates: 0,
    reporters: 0,
    ...overrides,
  }
}

/**
 * 10 sodas (ids 1-10) and 10 seltzers (ids 11-20).
 * Sodas 1-6 have 10..5 liked reports; sodas 7-10 have no data. Seltzers have right swipes only.
 */
function catalog(): DrinkStats[] {
  const drinks: DrinkStats[] = []
  for (let i = 1; i <= 10; i++) {
    const likes = i <= 6 ? 11 - i : 0
    drinks.push(drink(i, 'soda', { likes, reporters: likes }))
  }
  for (let i = 11; i <= 20; i++) {
    drinks.push(drink(i, 'seltzer', { right_swipes: 21 - i, left_swipes: 1 }))
  }
  return drinks
}

const slots = (items: OrderItem[]) => items.map((item) => `${item.slot}:${item.type}`)
const ids = (items: OrderItem[], slot: OrderItem['slot']) =>
  items.filter((item) => item.slot === slot).map((item) => item.soda_id)

describe('buildOrderList', () => {
  test('orders top sodas, top seltzers, trials, then backups', () => {
    const items = buildOrderList(catalog(), { seed: '2026-11-16' })

    expect(items).toHaveLength(13)
    expect(items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(slots(items).slice(0, 6)).toEqual([
      'top:soda', 'top:soda', 'top:soda',
      'top:seltzer', 'top:seltzer', 'top:seltzer',
    ])
    expect(items.slice(6, 9).every((item) => item.slot === 'trial')).toBe(true)
    expect(items.slice(9).every((item) => item.slot === 'backup')).toBe(true)
    expect(items.slice(9).filter((item) => item.type === 'soda')).toHaveLength(2)
    expect(items.slice(9).filter((item) => item.type === 'seltzer')).toHaveLength(2)
  })

  test('top slots take the best-scored drink of each type', () => {
    const items = buildOrderList(catalog(), { seed: '2026-11-16' })
    expect(ids(items, 'top')).toEqual([1, 2, 3, 11, 12, 13])
  })

  test('backups are the next two of each type, in overall rank order', () => {
    const items = buildOrderList(catalog(), { seed: '2026-11-16' })
    // Sodas 4 and 5 have liked reports, so they outrank swiped-only seltzers.
    expect(ids(items, 'backup')).toEqual([4, 5, 14, 15])
  })

  test('trials are low-data drinks that are not favorites', () => {
    const items = buildOrderList(catalog(), { seed: '2026-11-16' })
    const favorites = new Set([...ids(items, 'top'), ...ids(items, 'backup')])
    for (const id of ids(items, 'trial')) {
      expect(favorites.has(id)).toBe(false)
      const source = catalog().find((d) => d.id === id)!
      expect(source.reporters).toBeLessThan(3)
    }
    expect(new Set(ids(items, 'trial')).size).toBe(3)
  })

  test('drinks with 3+ reporters are never trials', () => {
    const drinks = [
      ...Array.from({ length: 5 }, (_, i) => drink(i + 1, 'soda', { likes: 5, reporters: 5 })),
      ...Array.from({ length: 5 }, (_, i) => drink(i + 6, 'seltzer', { likes: 5, reporters: 5 })),
      drink(11, 'soda', { likes: 1, hates: 2, reporters: 3 }),
      drink(12, 'seltzer', { reporters: 2, likes: 1, hates: 1 }),
    ]
    const items = buildOrderList(drinks, { seed: '2026-11-16' })
    expect(ids(items, 'trial')).toEqual([12])
  })

  test('same seed gives the same trials', () => {
    const a = buildOrderList(catalog(), { seed: '2026-11-16' })
    const b = buildOrderList(catalog(), { seed: '2026-11-16' })
    expect(a).toEqual(b)
  })

  test('different weeks give different trials over time', () => {
    const picks = new Set<string>()
    for (let week = 0; week < 8; week++) {
      const items = buildOrderList(catalog(), { seed: addDays('2026-11-16', week * 7) })
      picks.add(ids(items, 'trial').join(','))
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  test('avoids recent trials when enough other drinks are eligible', () => {
    const first = ids(buildOrderList(catalog(), { seed: '2026-11-16' }), 'trial')
    const next = ids(buildOrderList(catalog(), { seed: '2026-11-23', recentTrialIds: first }), 'trial')
    expect(next.some((id) => first.includes(id))).toBe(false)
  })

  test('falls back to recent trials when nothing else is eligible', () => {
    const drinks = [
      ...Array.from({ length: 5 }, (_, i) => drink(i + 1, 'soda', { right_swipes: 10 })),
      ...Array.from({ length: 5 }, (_, i) => drink(i + 6, 'seltzer', { right_swipes: 10 })),
      drink(11, 'soda'),
      drink(12, 'seltzer'),
      drink(13, 'soda'),
    ]
    const items = buildOrderList(drinks, { seed: '2026-11-16', recentTrialIds: [11, 12] })
    const trials = ids(items, 'trial')
    expect(trials[0]).toBe(13)
    expect(trials.slice(1).sort()).toEqual([11, 12])
  })

  test('favorites prefer drinks with evidence over unknown drinks', () => {
    const drinks = [
      drink(1, 'soda'),
      drink(2, 'soda', { right_swipes: 1, left_swipes: 9 }),
      drink(3, 'soda'),
      drink(4, 'seltzer'),
    ]
    const items = buildOrderList(drinks, { seed: '2026-11-16' })
    expect(items[0].soda_id).toBe(2)
  })

  test('a net-negative drink does not jump ahead of unknown drinks', () => {
    const drinks = [
      drink(1, 'soda', { hates: 1, reporters: 1 }),
      drink(2, 'soda'),
      drink(3, 'soda'),
      drink(4, 'soda'),
      drink(5, 'soda', { right_swipes: 2 }),
    ]
    const items = buildOrderList(drinks, { seed: '2026-11-16' })
    const top = items.filter((item) => item.slot === 'top').map((item) => item.soda_id)
    expect(top[0]).toBe(5)
    expect(top).not.toContain(1)
  })

  test('fills favorites by score when a type lacks evidence', () => {
    const drinks = [
      drink(1, 'soda', { likes: 1, reporters: 1 }),
      drink(2, 'soda'),
      drink(3, 'soda'),
      drink(4, 'seltzer'),
      drink(5, 'seltzer'),
    ]
    const items = buildOrderList(drinks, { seed: '2026-11-16' })
    const topSodas = items.filter((item) => item.slot === 'top' && item.type === 'soda').map((item) => item.soda_id)
    expect(topSodas[0]).toBe(1)
    expect([...topSodas].sort()).toEqual([1, 2, 3])
    expect(items.filter((item) => item.slot === 'top' && item.type === 'seltzer')).toHaveLength(2)
    expect(ids(items, 'trial')).toEqual([])
  })

  test('marks trials with no swipes or reports as having no data', () => {
    const items = buildOrderList(catalog(), { seed: '2026-11-16' })
    for (const item of items.filter((i) => i.slot === 'trial')) {
      const source = catalog().find((d) => d.id === item.soda_id)!
      expect(item.has_data).toBe(source.right_swipes + source.left_swipes + source.likes + source.hates > 0)
    }
    const noData = buildOrderList([drink(1, 'soda')], { seed: 'x' })
    expect(noData[0].has_data).toBe(false)
  })
})

describe('seeded sampling', () => {
  test('seededRandom is reproducible and in [0, 1)', () => {
    const a = seededRandom('2026-11-16')
    const b = seededRandom('2026-11-16')
    for (let i = 0; i < 100; i++) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  test('sampleBeta mean tracks alpha / (alpha + beta)', () => {
    const rng = seededRandom('beta')
    let total = 0
    const runs = 4000
    for (let i = 0; i < runs; i++) total += sampleBeta(8, 2, rng)
    expect(total / runs).toBeCloseTo(0.8, 1)
  })
})

describe('weekStartFor', () => {
  test('returns the Monday of the Eastern week', () => {
    expect(weekStartFor(new Date('2026-11-16T12:00:00Z'))).toBe('2026-11-16')
    expect(weekStartFor(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-16')
  })

  test('uses Eastern time, not UTC', () => {
    // Sunday 10 pm Eastern is already Monday in UTC.
    expect(weekStartFor(new Date('2026-11-16T03:00:00Z'))).toBe('2026-11-09')
  })

  test('addDays shifts calendar days', () => {
    expect(addDays('2026-11-16', -14)).toBe('2026-11-02')
  })
})

describe('fresh catalog (no data)', () => {
  // 30 sodas and 30 seltzers, ids and names in alphabetical order, all tied at the prior.
  const fresh = (): DrinkStats[] => [
    ...Array.from({ length: 30 }, (_, i) => drink(i + 1, 'soda')),
    ...Array.from({ length: 30 }, (_, i) => drink(i + 31, 'seltzer')),
  ]
  const favorites = (items: OrderItem[]) =>
    items.filter((item) => item.slot !== 'trial').map((item) => item.soda_id)

  test('tied favorites are not picked alphabetically', () => {
    const items = buildOrderList(fresh(), { seed: '2026-11-16' })
    const alphabetical = [1, 2, 3, 31, 32, 33, 4, 5, 34, 35]
    expect(favorites(items)).not.toEqual(alphabetical)
    expect(new Set(favorites(items))).not.toEqual(new Set(alphabetical))
  })

  test('tied favorites are reproducible for the same week', () => {
    const a = buildOrderList(fresh(), { seed: '2026-11-16' })
    const b = buildOrderList([...fresh()].reverse(), { seed: '2026-11-16' })
    expect(favorites(b)).toEqual(favorites(a))
  })

  test('tied favorites change from week to week', () => {
    const weeks = new Set<string>()
    for (let week = 0; week < 4; week++) {
      weeks.add(favorites(buildOrderList(fresh(), { seed: addDays('2026-11-16', week * 7) })).join(','))
    }
    expect(weeks.size).toBe(4)
  })

  test('the public leaderboard order still breaks ties by name', () => {
    const ranked = rankDrinks([drink(2, 'soda', { flavor: 'B' }), drink(1, 'soda', { flavor: 'C' }), drink(3, 'soda', { flavor: 'A' })])
    expect(ranked.map((d) => d.id)).toEqual([3, 2, 1])
  })

  test('rankForWeek keeps score order above the seeded tiebreak', () => {
    const drinks = [...fresh(), drink(99, 'soda', { likes: 1, reporters: 1 })]
    expect(rankForWeek(drinks, '2026-11-16')[0].id).toBe(99)
  })
})

describe('brand prior in the order list', () => {
  // Favorites fill from the 'Fav' brands; the trial pool is one unknown drink per brand.
  function catalogWithBrands(): DrinkStats[] {
    return [
      ...Array.from({ length: 5 }, (_, i) => drink(i + 1, 'soda', { brand: 'Fav Soda', likes: 5, reporters: 5 })),
      ...Array.from({ length: 5 }, (_, i) => drink(i + 6, 'seltzer', { brand: 'Fav Seltzer', likes: 5, reporters: 5 })),
      ...Array.from({ length: 3 }, (_, i) => drink(i + 11, 'soda', { brand: 'Hated', hates: 2, reporters: 2 })),
      ...Array.from({ length: 3 }, (_, i) => drink(i + 14, 'soda', { brand: 'Loved', likes: 2, reporters: 2 })),
      drink(20, 'soda', { brand: 'Hated' }),
      drink(21, 'soda', { brand: 'Loved' }),
      drink(22, 'soda', { brand: 'Unknown' }),
    ]
  }

  test('trial sampling is reproducible with brand priors', () => {
    const a = buildOrderList(catalogWithBrands(), { seed: '2026-11-16' })
    const b = buildOrderList([...catalogWithBrands()].reverse(), { seed: '2026-11-16' })
    expect(ids(b, 'trial')).toEqual(ids(a, 'trial'))
    expect(ids(a, 'trial')).toHaveLength(3)
  })

  test('Thompson draws favor an unknown drink from a loved brand over one from a hated brand', () => {
    let lovedFirst = 0
    const weeks = 60
    for (let week = 0; week < weeks; week++) {
      const drinks = catalogWithBrands().filter((d) => d.id !== 22)
      const items = buildOrderList(drinks, { seed: addDays('2026-11-16', week * 7), recentTrialIds: [] })
      const trials = ids(items, 'trial')
      const hatedIndex = trials.indexOf(20)
      const lovedIndex = trials.indexOf(21)
      if (lovedIndex !== -1 && (hatedIndex === -1 || lovedIndex < hatedIndex)) lovedFirst += 1
    }
    expect(lovedFirst / weeks).toBeGreaterThan(0.75)
  })

  test('favorites need a posterior at least the type mean', () => {
    const drinks = [
      drink(1, 'soda', { likes: 4, reporters: 4 }),
      drink(2, 'soda', { hates: 2, reporters: 2 }),
      drink(3, 'soda'),
      drink(4, 'soda'),
      drink(5, 'soda'),
      drink(6, 'soda'),
    ]
    const scored = rankForWeek(drinks, '2026-11-16')
    const hated = scored.find((d) => d.id === 2)!
    expect(hated.score).toBeLessThan(hated.type_mean)

    const items = buildOrderList(drinks, { seed: '2026-11-16' })
    const favorites = items.filter((item) => item.slot !== 'trial').map((item) => item.soda_id)
    expect(favorites[0]).toBe(1)
    expect(favorites).not.toContain(2)
  })

  test('the snapshot params record the brand prior constants', () => {
    const params = orderParams('2026-11-16', []) as { score: { meanShrink: number; brandPriorStrength: number } }
    expect(params.score.meanShrink).toBe(4)
    expect(params.score.brandPriorStrength).toBe(2)
  })
})
