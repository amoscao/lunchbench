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

describe('0012_soda_catalog.sql', () => {
  test('has one row per drink in scripts/data/sodas.json, in order', () => {
    expect(rows).toHaveLength(sodas.length)
    expect(rows.map((row) => row[0])).toEqual(sodas.map((soda) => soda.walmart_item_id))
  })

  test('matches brand, flavor, type and image key for every drink', () => {
    rows.forEach(([itemId, brand, flavor, type, key], index) => {
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
  })
})
