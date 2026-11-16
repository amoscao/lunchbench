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

type Row = { brand: string; flavor: string; type: 'soda' | 'seltzer' }
type Drink = SearchableSoda & { name: string }

// The REAL 124-drink catalog, in the order GET /api/soda/catalog returns it:
// ORDER BY brand ASC, flavor ASC, id ASC (SQLite binary collation, so "Zevia" sorts before "bubly").
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const catalog: Drink[] = (catalogJson as Row[])
  .map((row, i) => ({ id: i + 1, brand: row.brand, flavor: row.flavor, type: row.type, name: `${row.brand} ${row.flavor}` }))
  .sort((a, b) => binary(a.brand, b.brand) || binary(a.flavor, b.flavor) || a.id - b.id)

const names = (query: string, limit = MAX_RESULTS) => searchSodas(query, catalog, limit).map((s) => s.name)
const all = (query: string) => names(query, 1000)
const first = (query: string) => names(query)[0]

test('the fixture is the full catalog', () => {
  expect(catalog).toHaveLength(124)
})

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

  test.each([
    ['dr pepper', 'Dr Pepper Original'],
    ['Dr. Pepper', 'Dr Pepper Original'],
    ['la croix', 'LaCroix Pure'],
    ['a and w', 'A&W Root Beer'],
    ['aw', 'A&W Root Beer'],
    ['barqs', "Barq's Root Beer"],
  ])('%s -> %s', (query, name) => {
    expect(first(query)).toBe(name)
  })
})

describe('typos', () => {
  test.each([
    ['olipep', 'OLIPOP'],
    ['spirte', 'Sprite'],
    ['lacrox', 'LaCroix'],
  ])('%s finds only %s', (query, brand) => {
    const results = all(query)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((name) => name.startsWith(brand))).toBe(true)
  })

  test('baja blsat -> Mountain Dew Baja Blast', () => {
    expect(all('baja blsat')).toEqual(['Mountain Dew Baja Blast'])
  })

  test.each(['mint', 'pear', 'wine', 'dart', 'cane sugar'])('%s has no look-alike false positives', (query) => {
    expect(all(query)).toEqual([])
  })

  test('colas finds colas, not Kolashanpan', () => {
    const results = all('colas')
    expect(results.length).toBeGreaterThan(0)
    expect(results).not.toContain('LS Cascada Kolashanpan')
    expect(results.every((name) => /cola/i.test(name))).toBe(true)
  })

  test('typos rank by edit distance: rasberry lists Raspberry drinks before Cranberry', () => {
    const results = all('rasberry')
    const firstCranberry = results.indexOf('poppi Cranberry Fizz')
    const raspberries = results.filter((name) => /raspberry/i.test(name))
    expect(raspberries.length).toBeGreaterThanOrEqual(4)
    expect(results.slice(0, raspberries.length).every((name) => /raspberry/i.test(name))).toBe(true)
    if (firstCranberry !== -1) expect(firstCranberry).toBeGreaterThanOrEqual(raspberries.length)
  })

  test('typos rank by edit distance: lemonaid lists Lemonade before Lemon Lime', () => {
    const results = all('lemonaid')
    expect(results[0]).toMatch(/Lemonade$/)
    expect(results[1]).toMatch(/Lemonade$/)
    const lemonLime = results.findIndex((name) => /Lemon Lime/.test(name))
    if (lemonLime !== -1) expect(lemonLime).toBeGreaterThan(1)
  })

  test('one catalog word cannot satisfy two query words: coka cola finds Coca-Cola, not Zevia', () => {
    for (const query of ['coka cola', 'coda cola', 'coca colla']) {
      const results = all(query)
      expect(results[0], query).toMatch(/^Coca-Cola /)
      expect(results.slice(0, 7).every((name) => name.startsWith('Coca-Cola')), query).toBe(true)
      expect(results, query).not.toContain('Zevia Cola')
    }
  })
})

describe('word order, prefixes and inside-word matches', () => {
  test('word order does not matter', () => {
    expect(first('lemon strawberry poppi')).toBe('poppi Strawberry Lemon')
  })

  test('each word matches by prefix while typing', () => {
    expect(first('str lem')).toBe('poppi Strawberry Lemon')
  })

  test('words match inside longer words, below prefix matches', () => {
    const berry = all('berry')
    expect(berry[0]).toBe('Waterloo Summer Berry')
    expect(berry).toEqual(expect.arrayContaining(['bubly Raspberry', 'Polar Blackberry Mango', 'bubly Strawberry', 'LaCroix Cran-Raspberry']))
    expect(all('fruit')).toEqual(expect.arrayContaining(['bubly Grapefruit', 'Polar Ruby Red Grapefruit']))
    expect(all('berries')).toEqual(['Bloom Nutrition Strawberries & Cream'])
    expect(all('mousse')).toEqual(['LaCroix Pamplemousse'])
  })

  test('one-letter queries rank brand and flavor matches above the type word', () => {
    const top = names('s')
    expect(top).toHaveLength(8)
    expect(top.every((name) => name.split(' ').some((word) => /^s/i.test(word)))).toBe(true)
  })

  test.each([
    ['diet coke', 'coke diet', 'Coca-Cola Diet'],
    ['coke zero', 'zero coke', 'Coca-Cola Zero Sugar'],
    ['pepsi max', 'max pepsi', 'Pepsi Zero Sugar'],
  ])('%s and %s give the same results, %s first', (a, b, top) => {
    expect(all(a)).toEqual(all(b))
    expect(first(a)).toBe(top)
  })
})

describe('brand-only queries list the flagship first', () => {
  test.each([
    ['coke', 'Coca-Cola Original'],
    ['pepsi', 'Pepsi Original'],
    ['dp', 'Dr Pepper Original'],
    ['dr pepper', 'Dr Pepper Original'],
    ['dew', 'Mountain Dew Original'],
    ['mountain dew', 'Mountain Dew Original'],
    ['polar', 'Polar Original'],
    ['lacroix', 'LaCroix Pure'],
    ['sprite', 'Sprite Original'],
  ])('%s -> %s', (query, name) => {
    expect(first(query)).toBe(name)
  })
})

describe('aliases', () => {
  // Expected top result for every alias key, so each entry is checked against the real catalog.
  const topByAlias: Record<string, string> = {
    'coke': 'Coca-Cola Original',
    'coca cola': 'Coca-Cola Original',
    'cocacola': 'Coca-Cola Original',
    'max': 'Pepsi Zero Sugar',
    'dew': 'Mountain Dew Original',
    'mtn': 'Mountain Dew Original',
    'mtn dew': 'Mountain Dew Original',
    'mountain do': 'Mountain Dew Original',
    'baja': 'Mountain Dew Baja Blast',
    'dp': 'Dr Pepper Original',
    'dr p': 'Dr Pepper Original',
    'doctor pepper': 'Dr Pepper Original',
    'root beer': "Barq's Root Beer",
    'rootbeer': "Barq's Root Beer",
    'ginger ale': 'Great Value Ginger Ale',
    'gingerale': 'Great Value Ginger Ale',
    'la croix': 'LaCroix Pure',
    'lacroix': 'LaCroix Pure',
    'bubbly': 'bubly Blackberry',
    'gv': "Sam's Choice Cola",
    'great value': 'Great Value Dr Thunder',
    'walmart': "Sam's Choice Cola",
    'walmart brand': "Sam's Choice Cola",
    'olipop': 'OLIPOP Cherry Cola',
    'oli pop': 'OLIPOP Cherry Cola',
    'poppy': 'poppi Orange',
    'seltzer': 'LaCroix Pure',
    'seltzers': 'LaCroix Pure',
    'sparkling': 'Sparkling Ice Blue Raspberry +Caffeine',
    'sparkling water': 'LaCroix Pure',
    'fizzy water': 'LaCroix Pure',
    'soda': 'OLIPOP Cream Soda',
    'sodas': 'OLIPOP Cream Soda',
    'pop': 'poppi Doc Pop',
    'zero': 'Pepsi Zero Sugar',
    'diet': 'Pepsi Diet',
    'sugar free': 'Canada Dry Ginger Ale Caffeine-Free Zero Sugar',
    'orange': 'Fanta Orange',
    'cherry': 'bubly Cherry',
    'lemon lime': 'Starry Lemon Lime',
    'creme': 'OLIPOP Cream Soda',
  }

  test('covers every alias key', () => {
    expect(Object.keys(topByAlias).sort()).toEqual(Object.keys(SODA_ALIASES).sort())
  })

  test.each(Object.entries(topByAlias))('%s -> %s', (alias, top) => {
    expect(first(alias)).toBe(top)
  })

  test.each([
    ['coke', 'Coca-Cola'],
    ['dew', 'Mountain Dew'],
    ['dp', 'Dr Pepper'],
    ['la croix', 'LaCroix'],
    ['bubbly', 'bubly'],
    ['olipop', 'OLIPOP'],
    ['poppy', 'poppi'],
  ])('%s only finds %s', (query, brand) => {
    const results = all(query)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((name) => name.startsWith(brand))).toBe(true)
  })

  test('creme soda finds cream sodas', () => {
    expect(names('creme soda').slice(0, 2)).toEqual(['OLIPOP Cream Soda', 'poppi Cream Soda'])
  })

  test('diet cherry ranks Coca-Cola Diet Cherry first', () => {
    expect(first('diet cherry')).toBe('Coca-Cola Diet Cherry')
  })

  test('root beer finds every root beer', () => {
    const expected = catalog.filter((s) => /root beer/i.test(s.flavor)).map((s) => s.name).sort()
    expect(expected).toEqual(expect.arrayContaining([
      'A&W Root Beer', "Barq's Root Beer", 'Mug Root Beer', 'Great Value Root Beer',
      'OLIPOP Classic Root Beer', 'Zevia Creamy Root Beer', 'Bloom Nutrition Root Beer Float',
    ]))
    expect(all('root beer').sort()).toEqual(expected)
    expect(all('rootbeer').sort()).toEqual(expected)
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

  test.each(['zero', 'diet', 'sugar free'])('%s finds only Zero Sugar and Diet variants', (query) => {
    const results = all(query)
    expect(results).toEqual(expect.arrayContaining(['Coca-Cola Zero Sugar', 'Coca-Cola Diet', 'Pepsi Zero Sugar', 'Pepsi Diet']))
    expect(results.every((name) => /zero|diet/i.test(name))).toBe(true)
  })

  test('orange, cherry and lemon lime find their flavors', () => {
    expect(all('orange')).toEqual(expect.arrayContaining(['Fanta Orange', 'Sunkist Orange', 'Crush Orange Caffeine-Free', 'Kuii Mandarin', 'LaCroix Tangerine']))
    expect(all('cherry').every((name) => /cherry/i.test(name))).toBe(true)
    expect(all('lemon lime')).toEqual(expect.arrayContaining(['poppi Lemon Lime', 'Starry Lemon Lime', 'Sprite Original', '7UP Original']))
  })

  test.each([
    ['cok', 'Coca-Cola Original'],
    ['diet cok', 'Coca-Cola Diet'],
    ['pepsi m', 'Pepsi Zero Sugar'],
    ['doctor p', 'Dr Pepper Original'],
    ['walm', "Sam's Choice Cola"],
    ['fizzy w', 'LaCroix Pure'],
    ['bubbl', 'bubly Blackberry'],
  ])('aliases work while typing: %s -> %s', (query, top) => {
    expect(first(query)).toBe(top)
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
    const queries = ['coke', 'baja blsat', 'lemon strawberry poppi', 'olipep', 'walmart brand', 's', 'coka cola', 'rasberry']
    const start = performance.now()
    for (const query of queries) searchSodas(query, catalog)
    expect((performance.now() - start) / queries.length).toBeLessThan(30)
  })
})
