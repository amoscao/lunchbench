import { describe, expect, test } from 'vitest'
import catalogJson from '../../scripts/data/sodas.json'
import {
  allowedTypos,
  damerauDistance,
  MAX_RESULTS,
  normalizeText,
  SODA_ALIASES,
  searchSodas,
  type SearchableSoda,
} from './soda-search'

type Row = { walmart_item_id: string; brand: string; flavor: string; type: 'soda' | 'seltzer' }
const catalog: Array<SearchableSoda & { name: string }> = (catalogJson as Row[]).map((row, i) => ({
  id: i + 1,
  brand: row.brand,
  flavor: row.flavor,
  type: row.type,
  name: `${row.brand} ${row.flavor}`,
}))

const names = (query: string, limit = MAX_RESULTS) => searchSodas(query, catalog, limit).map((s) => s.name)
const all = (query: string) => names(query, 1000)
const first = (query: string) => names(query)[0]

describe('normalization', () => {
  test('drops case, punctuation, apostrophes and accents', () => {
    expect(normalizeText("Barq's")).toBe('barqs')
    expect(normalizeText('Dr. Pepper')).toBe('dr pepper')
    expect(normalizeText('A&W')).toBe('a w')
    expect(normalizeText('Café  Crème')).toBe('cafe creme')
  })

  test('typo budget grows with word length', () => {
    expect(allowedTypos(3)).toBe(0)
    expect(allowedTypos(4)).toBe(1)
    expect(allowedTypos(7)).toBe(1)
    expect(allowedTypos(8)).toBe(2)
    expect(damerauDistance('spirte', 'sprite')).toBe(1)
  })
})

describe('typo tolerance', () => {
  test.each([
    ['olipep', 'OLIPOP'],
    ['spirte', 'Sprite'],
    ['lacrox', 'LaCroix'],
  ])('%s finds %s', (query, brand) => {
    const results = names(query)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((name) => name.startsWith(brand))).toBe(true)
  })

  test('baja blsat finds Mountain Dew Baja Blast', () => {
    expect(first('baja blsat')).toBe('Mountain Dew Baja Blast')
  })

  test('exact and prefix matches rank above typo matches', () => {
    // "cola" is exact for many drinks; a typo neighbor must not outrank them.
    const results = all('cola')
    expect(results.slice(0, 5).every((name) => /\bcola\b/i.test(name))).toBe(true)
  })
})

describe('order, prefixes and normalization in queries', () => {
  test('word order does not matter', () => {
    expect(first('lemon strawberry poppi')).toBe('poppi Strawberry Lemon')
  })

  test('each word matches by prefix while typing', () => {
    expect(first('str lem')).toBe('poppi Strawberry Lemon')
  })

  test.each([
    ['dr pepper', 'Dr Pepper'],
    ['Dr. Pepper', 'Dr Pepper'],
    ['la croix', 'LaCroix'],
    ['a and w', 'A&W'],
    ['aw', 'A&W'],
    ['barqs', "Barq's"],
  ])('%s finds %s', (query, brand) => {
    expect(first(query).startsWith(brand)).toBe(true)
  })
})

describe('aliases', () => {
  test.each([
    ['coke', 'Coca-Cola'],
    ['coca cola', 'Coca-Cola'],
    ['cocacola', 'Coca-Cola'],
    ['dew', 'Mountain Dew'],
    ['mtn dew', 'Mountain Dew'],
    ['mountain do', 'Mountain Dew'],
    ['dp', 'Dr Pepper'],
    ['dr p', 'Dr Pepper'],
    ['doctor pepper', 'Dr Pepper'],
    ['la croix', 'LaCroix'],
    ['lacroix', 'LaCroix'],
    ['bubbly', 'bubly'],
    ['olipop', 'OLIPOP'],
    ['oli pop', 'OLIPOP'],
    ['poppy', 'poppi'],
  ])('%s only finds %s', (query, brand) => {
    const results = all(query)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((name) => name.startsWith(brand))).toBe(true)
  })

  test.each([
    ['diet coke', 'Coca-Cola Diet'],
    ['coke zero', 'Coca-Cola Zero Sugar'],
    ['pepsi max', 'Pepsi Zero Sugar'],
    ['baja', 'Mountain Dew Baja Blast'],
    ['diet cherry', 'Coca-Cola Diet Cherry'],
  ])('%s ranks %s first', (query, name) => {
    expect(first(query)).toBe(name)
  })

  test('root beer and rootbeer find every root beer', () => {
    const expected = catalog.filter((s) => /root beer/i.test(s.flavor)).map((s) => s.name).sort()
    expect(expected).toEqual(expect.arrayContaining([
      'A&W Root Beer', "Barq's Root Beer", 'Mug Root Beer', 'Great Value Root Beer',
      'OLIPOP Classic Root Beer', 'Zevia Creamy Root Beer', 'Bloom Nutrition Root Beer Float',
    ]))
    expect(all('root beer').sort()).toEqual(expected)
    expect(all('rootbeer').sort()).toEqual(expected)
  })

  test('ginger ale finds every ginger ale', () => {
    const expected = catalog.filter((s) => /ginger ale/i.test(s.flavor)).map((s) => s.name).sort()
    expect(expected.length).toBeGreaterThanOrEqual(4)
    expect(all('ginger ale').sort()).toEqual(expected)
  })

  test.each(['gv', 'great value', 'walmart brand'])('%s finds all three Walmart brands', (query) => {
    const brands = new Set(searchSodas(query, catalog, 1000).map((s) => s.brand))
    expect(brands).toEqual(new Set(['Great Value', "Sam's Choice", 'bettergoods']))
  })

  test.each(['seltzer', 'sparkling water', 'fizzy water'])('%s finds every seltzer and nothing else', (query) => {
    const results = searchSodas(query, catalog, 1000)
    expect(results.length).toBe(catalog.filter((s) => s.type === 'seltzer').length)
    expect(results.every((s) => s.type === 'seltzer')).toBe(true)
  })

  test.each(['soda', 'pop'])('%s finds every soda', (query) => {
    const results = searchSodas(query, catalog, 1000)
    expect(results.length).toBe(catalog.filter((s) => s.type === 'soda').length)
  })

  test.each(['zero', 'diet', 'sugar free'])('%s finds Zero Sugar and Diet variants', (query) => {
    const results = all(query)
    expect(results).toEqual(expect.arrayContaining(['Coca-Cola Zero Sugar', 'Coca-Cola Diet', 'Pepsi Zero Sugar', 'Pepsi Diet']))
    expect(results.every((name) => /zero|diet/i.test(name))).toBe(true)
  })

  test('orange, cherry and lemon lime find their flavors', () => {
    expect(all('orange')).toEqual(expect.arrayContaining(['Fanta Orange', 'Sunkist Orange', 'Crush Orange Caffeine-Free', 'Kuii Mandarin', 'LaCroix Tangerine']))
    expect(all('cherry').every((name) => /cherry/i.test(name))).toBe(true)
    expect(all('cherry')).toEqual(expect.arrayContaining(['Coca-Cola Cherry', 'Pepsi Wild Cherry']))
    expect(all('lemon lime')).toEqual(expect.arrayContaining(['poppi Lemon Lime', 'Starry Lemon Lime', 'Sprite Original', '7UP Original']))
  })

  test('every alias expansion matches at least one real catalog drink', () => {
    for (const [alias, expansions] of Object.entries(SODA_ALIASES)) {
      for (const expansion of expansions) {
        expect(all(expansion).length, `${alias} -> ${expansion}`).toBeGreaterThan(0)
      }
      expect(all(alias).length, alias).toBeGreaterThan(0)
    }
  })
})

describe('limits and non-matches', () => {
  test('returns nothing for an empty query or a non-match', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('xyz')).toEqual([])
    expect(names('qwertyuiop')).toEqual([])
  })

  test('caps results at 8', () => {
    expect(MAX_RESULTS).toBe(8)
    expect(names('soda')).toHaveLength(8)
  })

  test('stays fast over the full catalog', () => {
    const start = performance.now()
    for (const query of ['coke', 'baja blsat', 'lemon strawberry poppi', 'olipep', 'walmart brand']) {
      searchSodas(query, catalog)
    }
    expect(performance.now() - start).toBeLessThan(250)
  })
})
