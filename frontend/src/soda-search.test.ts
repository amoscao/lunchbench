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
  // Every alias key, checked against the real catalog. Exact top results only where the order is
  // intended (flagship, alias order, best match); otherwise the top result's brand or set.
  const exactTop: Record<string, string> = {
    'coke': 'Coca-Cola Original',
    'coca cola': 'Coca-Cola Original',
    'cocacola': 'Coca-Cola Original',
    'dew': 'Mountain Dew Original',
    'mtn': 'Mountain Dew Original',
    'mtn dew': 'Mountain Dew Original',
    'mountain do': 'Mountain Dew Original',
    'baja': 'Mountain Dew Baja Blast',
    'dp': 'Dr Pepper Original',
    'dr p': 'Dr Pepper Original',
    'doctor pepper': 'Dr Pepper Original',
    'la croix': 'LaCroix Pure',
    'lacroix': 'LaCroix Pure',
    'lemon lime': 'Starry Lemon Lime',
  }
  const topIn: Record<string, (drink: Drink) => boolean> = {
    'max': (d) => d.brand === 'Pepsi' || /zero/i.test(d.flavor),
    'root beer': (d) => /root beer/i.test(d.flavor),
    'rootbeer': (d) => /root beer/i.test(d.flavor),
    'ginger ale': (d) => /ginger ale/i.test(d.flavor),
    'gingerale': (d) => /ginger ale/i.test(d.flavor),
    'bubbly': (d) => d.brand === 'bubly',
    'gv': (d) => d.brand === 'Great Value',
    'great value': (d) => d.brand === 'Great Value',
    'walmart': (d) => d.brand === 'Great Value',
    'walmart brand': (d) => d.brand === 'Great Value',
    'olipop': (d) => d.brand === 'OLIPOP',
    'oli pop': (d) => d.brand === 'OLIPOP',
    'poppy': (d) => d.brand === 'poppi',
    'seltzer': (d) => d.type === 'seltzer',
    'seltzers': (d) => d.type === 'seltzer',
    'sparkling': (d) => d.type === 'seltzer',
    'sparkling water': (d) => d.type === 'seltzer',
    'fizzy water': (d) => d.type === 'seltzer',
    'soda': (d) => d.type === 'soda',
    'sodas': (d) => d.type === 'soda',
    'pop': (d) => d.type === 'soda',
    'zero': (d) => /zero|diet/i.test(d.flavor),
    'diet': (d) => /zero|diet/i.test(d.flavor),
    'sugar free': (d) => /zero|diet/i.test(d.flavor),
    'orange': (d) => /orange|tangerine|mandarin/i.test(d.flavor),
    'cherry': (d) => /cherry/i.test(d.flavor),
    'creme': (d) => /cream/i.test(d.flavor),
  }

  test('covers every alias key', () => {
    expect([...Object.keys(exactTop), ...Object.keys(topIn)].sort()).toEqual(Object.keys(SODA_ALIASES).sort())
  })

  test.each(Object.entries(exactTop))('%s -> %s', (alias, top) => {
    expect(first(alias)).toBe(top)
  })

  test.each(Object.keys(topIn))('%s -> first result is in the expected set', (alias) => {
    const top = searchSodas(alias, catalog)[0]
    expect(top, alias).toBeDefined()
    expect(topIn[alias](top), `${alias} -> ${top.brand} ${top.flavor}`).toBe(true)
  })

  test.each(['gv', 'walmart', 'walmart brand'])('%s lists the first-listed brand (Great Value) first', (query) => {
    const results = searchSodas(query, catalog, 1000).map((d) => d.brand)
    const greatValue = results.filter((brand) => brand === 'Great Value').length
    expect(results.slice(0, greatValue).every((brand) => brand === 'Great Value')).toBe(true)
  })

  test.each([
    ['sprite', 'Sprite Original'],
    ['polar', 'Polar Original'],
    ['pepsi', 'Pepsi Original'],
  ])('brand %s -> %s', (query, top) => {
    expect(first(query)).toBe(top)
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
    ['fizzy w', 'LaCroix Pure'],
    ['bubbl', 'bubly Blackberry'],
  ])('aliases work while typing: %s -> %s', (query, top) => {
    expect(first(query)).toBe(top)
  })

  test('walm lists Great Value first while typing walmart', () => {
    expect(searchSodas('walm', catalog)[0].brand).toBe('Great Value')
  })

  test.each([
    ['doct', 'Dr Pepper Original'],
    ['docto', 'Dr Pepper Original'],
    ['doctor', 'Dr Pepper Original'],
  ])('a longer alias key counts while typing: %s -> %s', (query, top) => {
    expect(first(query)).toBe(top)
  })

  test('fizzy already lists seltzers before "w" is typed', () => {
    const results = searchSodas('fizzy', catalog, 1000)
    expect(results.filter((d) => d.type === 'seltzer').length).toBe(catalog.filter((d) => d.type === 'seltzer').length)
    expect(results.map((d) => d.name)).toContain('poppi Cranberry Fizz')
  })
})

describe('every catalog drink is findable by its name', () => {
  test('exact name, lowercase name, and flavor-then-brand each list the drink first', () => {
    const misses: string[] = []
    for (const drink of catalog) {
      for (const query of [drink.name, drink.name.toLowerCase(), `${drink.flavor} ${drink.brand}`]) {
        const top = searchSodas(query, catalog)[0]
        if (top?.id !== drink.id) misses.push(`${query} -> ${top ? `${top.brand} ${top.flavor}` : 'nothing'}`)
      }
    }
    expect(misses).toEqual([])
  })

  test.each([
    ['mountain dew dirty dew', 'Mountain Dew Dirty Dew Cream Soda'],
    ['mtn dew dirty dew', 'Mountain Dew Dirty Dew Cream Soda'],
    ['dirty dew zero', 'Mountain Dew Dirty Dew Cream Soda Zero Sugar'],
  ])('a word repeated in brand and flavor can match twice: %s -> %s', (query, top) => {
    expect(first(query)).toBe(top)
  })

  test('a bare leading "s" still lets later words find their drink', () => {
    expect(all('s sc')).toContain('Schweppes Ginger Ale Caffeine-Free')
    expect(all('s sp')).toEqual(expect.arrayContaining(['Sprite Original', 'Sprite Zero Sugar']))
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

  test('long repeated queries stay fast (no exponential backtracking)', () => {
    for (const query of [
      Array(16).fill('seltzer').join(' '),
      Array(16).fill('soda').join(' '),
      Array(30).fill('s').join(' '),
      'S S S S S S S xyz',
      'dew dew dew dew dew dew dew dew',
      's sc s sp s sc s sp',
    ]) {
      const start = performance.now()
      searchSodas(query, catalog)
      expect(performance.now() - start, query.slice(0, 20)).toBeLessThan(50)
    }
  })

  test('only the first 8 query words count', () => {
    // Words 4-8 ("soda") match the type word; the 9th ("xyz") would match nothing but is ignored.
    const query = ['coke', 'diet', 'cherry', 'soda', 'soda', 'soda', 'soda', 'soda', 'xyz'].join(' ')
    expect(first(query)).toBe('Coca-Cola Diet Cherry')
    expect(names(query.replace(/ soda/g, ''))).toEqual([])
  })

  test('stays fast over the full catalog', () => {
    const queries = ['coke', 'baja blsat', 'lemon strawberry poppi', 'olipep', 'walmart brand', 's', 'coka cola', 'rasberry']
    const start = performance.now()
    for (const query of queries) searchSodas(query, catalog)
    expect((performance.now() - start) / queries.length).toBeLessThan(30)
  })
})
