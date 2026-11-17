import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain ESM script without type declarations
import { imageKey, uuidv5 } from '../../scripts/import-sodas.mjs'

const root = new URL('../../', import.meta.url)
const sodas = JSON.parse(readFileSync(fileURLToPath(new URL('scripts/data/sodas.json', root)), 'utf8')) as Array<{
  walmart_item_id: string
  brand: string
  flavor: string
  type: string
  image_ext: string
}>
const migration = readFileSync(fileURLToPath(new URL('migrations/0012_soda_catalog.sql', root)), 'utf8')
const ROW_RE = /^\s*\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)[,;]$/
const unquote = (value: string) => value.replace(/''/g, "'")
const rows = migration.split('\n')
  .map((line) => line.match(ROW_RE))
  .filter((match): match is RegExpMatchArray => match !== null)
  .map((match) => match.slice(1, 6).map(unquote))

// 0012 shipped with the full catalog and can't be edited. Drinks taken off later (0015, issue #296)
// are deactivated by migration and dropped from sodas.json, so the source data matches what is live.
const removal = readFileSync(fileURLToPath(new URL('migrations/0015_remove_olipop.sql', root)), 'utf8')
const removedIds = new Set(
  removal.slice(removal.indexOf('UPDATE sodas')).match(/'(\d+)'/g)!.map((quoted) => quoted.slice(1, -1))
)
const liveRows = rows.filter((row) => !removedIds.has(row[0]))

describe('0012_soda_catalog.sql', () => {
  test('0015 removes exactly the 9 OLIPOP drinks', () => {
    expect([...removedIds].sort()).toEqual(rows.filter((row) => row[1] === 'OLIPOP').map((row) => row[0]).sort())
    expect(removedIds.size).toBe(9)
  })

  test('minus removed drinks, has one row per drink in scripts/data/sodas.json, in order', () => {
    expect(liveRows).toHaveLength(sodas.length)
    expect(liveRows.map((row) => row[0])).toEqual(sodas.map((soda) => soda.walmart_item_id))
    expect(sodas.some((soda) => removedIds.has(soda.walmart_item_id))).toBe(false)
  })

  test('matches brand, flavor, type and image key for every live drink', () => {
    liveRows.forEach(([itemId, brand, flavor, type, key], index) => {
      const soda = sodas[index]
      expect({ itemId, brand, flavor, type, key }).toEqual({
        itemId: soda.walmart_item_id,
        brand: soda.brand,
        flavor: soda.flavor,
        type: soda.type,
        key: imageKey(soda),
      })
    })
  })

  test('image keys are UUIDv5 of the Walmart item URL and pass the image route pattern', () => {
    expect(uuidv5('https://www.walmart.com/ip/5212491407')).toBe('17b11440-9012-57b4-b205-89510a9c304c')
    const publicKey = /^images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i
    for (const row of rows) expect(row[4]).toMatch(publicKey)
    expect(new Set(rows.map((row) => row[4])).size).toBe(rows.length)
  })

  test('seed.sql sample drinks use catalog keys', () => {
    const seed = readFileSync(fileURLToPath(new URL('migrations/seed.sql', root)), 'utf8')
    const catalogKeys = new Map(rows.map((row) => [row[0], row[4]]))
    const seedRows = seed.split('\n').map((line) => line.match(ROW_RE)).filter((m): m is RegExpMatchArray => m !== null)
    expect(seedRows.length).toBe(14)
    for (const match of seedRows) expect(match[5]).toBe(catalogKeys.get(match[1]))
    expect(seedRows.some((match) => removedIds.has(match[1]))).toBe(false)
  })
})

describe('0014_soda_barcodes_seed.sql', () => {
  const barcodeMigration = readFileSync(fileURLToPath(new URL('migrations/0014_soda_barcodes_seed.sql', root)), 'utf8')
  const shipped = [...barcodeMigration.matchAll(/\('(\d{13})', '(\d+)'\)/g)].map((m) => ({ code: m[1], item: m[2] }))
  const source = JSON.parse(readFileSync(fileURLToPath(new URL('scripts/data/soda-barcodes.json', root)), 'utf8')) as Record<string, { codes: Array<{ code: string }> }>

  test('minus removed drinks, matches scripts/data/soda-barcodes.json', () => {
    const live = shipped.filter((row) => !removedIds.has(row.item)).map((row) => `${row.item}:${row.code}`).sort()
    const fromSource = Object.entries(source).flatMap(([item, entry]) => entry.codes.map((c) => `${item}:${c.code}`)).sort()
    expect(live).toEqual(fromSource)
    expect(Object.keys(source).some((item) => removedIds.has(item))).toBe(false)
    expect(shipped.filter((row) => removedIds.has(row.item))).toHaveLength(19)
  })
})
