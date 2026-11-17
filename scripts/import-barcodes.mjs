#!/usr/bin/env node
// One-off Sodabench barcode import from Open Food Facts.
//
//   node scripts/import-barcodes.mjs fetch [--cache DIR]
//     Query the Open Food Facts search API (search.openfoodfacts.org) once per brand and once per
//     drink, US products only. Raw responses are cached in DIR (default: $TMPDIR/lunchbench-off-cache),
//     so a re-run only fetches what is missing. Requests run one at a time, 3 s apart.
//
//   node scripts/import-barcodes.mjs match [--cache DIR]
//     Match cached products to catalog drinks and write scripts/data/soda-barcodes.json.
//
//   node scripts/import-barcodes.mjs sql
//     Write migrations/0014_soda_barcodes_seed.sql from scripts/data/soda-barcodes.json.
//
// Codes are stored as 13-digit GTINs: UPC-E is expanded to UPC-A, then UPC-A and EAN-8 are
// zero-padded. Every code has a valid check digit. The migration keys drinks by walmart_item_id,
// so it works against the full catalog (production) and the 14-drink seed (local, E2E).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SODAS_FILE = join(ROOT, 'scripts', 'data', 'sodas.json')
const BARCODES_FILE = join(ROOT, 'scripts', 'data', 'soda-barcodes.json')
const MIGRATION_FILE = join(ROOT, 'migrations', '0014_soda_barcodes_seed.sql')
const USER_AGENT = 'lunchbench-catalog-import/1.0'
const SEARCH_URL = 'https://search.openfoodfacts.org/search'
const FIELDS = 'code,product_name,product_name_en,brands,quantity'
const REQUEST_GAP_MS = 3000

// Codes a manual review of the match output rejected (wrong drink, variety pack, mislabeled entry).
const EXCLUDED_CODES = new Set([
  '0049000062137', // "Sprite 0": Sprite Zero, not Sprite Original
  '0410001227991', // in-store (number system 4) code, not a retail UPC
])

// Catalog brand -> extra spellings seen in Open Food Facts `brands`.
const BRAND_ALIASES = {
  'Coca-Cola': ['coke', 'cocacola', 'dietcoke'],
  'A&W': ['aw', 'awrootbeer'],
  '7UP': ['7up', '7-up'],
  'Bloom Nutrition': ['bloom'],
  'Great Value': ['greatvalue', 'walmart'],
  "Sam's Choice": ['samschoice', 'walmart'],
  'Mountain Dew': ['mountaindew', 'mtndew'],
  'Dr Pepper': ['drpepper'],
  'Sparkling Ice': ['sparklingice'],
  'LS Cascada': ['cascada'],
  'Malta India': ['india'],
}

// Extra brand words seen in product names ("Coke", "Mtn Dew", "La Croix").
const BRAND_WORDS = {
  'Coca-Cola': ['coke'],
  'Mountain Dew': ['mtn'],
  'LaCroix': ['la', 'croix'],
  'Pepsi': ['cola'],
  'Dr Pepper': ['dr'],
  'A&W': ['a', 'w', 'aw'],
  '7UP': ['7', 'up'],
}

// Words that do not change which drink a product is. Matching is strict: every word of a product
// name must be a flavor word of the drink, a brand word, one of these, or a number. Anything else
// ("Winter Spiced Cranberry", "with Coffee", "Mexican") means a different drink, so it is skipped.
const GENERIC_WORDS = new Set([
  'soda', 'pop', 'soft', 'drink', 'beverage', 'can', 'bottle', 'glas', 'glass', 'sparkling', 'water',
  'seltzer', 'natural', 'naturally', 'essenced', 'flavored', 'flavor', 'classic', 'original', 'the',
  'and', 'with', 'by', 'of', 'fl', 'oz', 'ml', 'l', 'cl', 'liter', 'litre', 'pack', 'pk', 'ct', 'x',
  'premium', 'pure', 'caffeine',
])

const WEAK_FLAVOR_WORDS = new Set(['diet', 'zero', 'caffeinefree', 'real', 'sugar'])

function isGenericWord(word) {
  return GENERIC_WORDS.has(word) || /^\d+(oz|ml|l|pk|ct)?$/.test(word)
}

// --- GTIN helpers (same rules as worker/src/barcode.ts and frontend/src/utils/barcode.ts) ---

function checkDigitValid(digits) {
  let sum = 0
  for (let i = digits.length - 2, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

function expandUpcE(code) {
  const ns = code[0]
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7)
  let body
  if (d6 <= '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return `${ns}${body}${code[7]}`
}

/**
 * Open Food Facts code to a 13-digit GTIN, or null. US retail codes only (UPC-A, UPC-E):
 * - OFF zero-pads 8-digit codes to 13. The 8-digit codes on US cans are UPC-E (number system 0),
 *   which a scanner reports as UPC-E, so they are expanded to UPC-A. Other 8-digit codes (EAN-8,
 *   non-US) are dropped.
 * - 12/13-digit codes are kept only as UPC-A (GTIN-13 starting with 0). Other EAN-13 prefixes are
 *   non-US packs of the same drink, which nobody in the office will scan.
 */
export function normalizeOffCode(raw) {
  let code = String(raw ?? '').trim()
  if (!/^\d+$/.test(code)) return null
  if (code.length === 14 && code.startsWith('0')) code = code.slice(1)
  if (code.length === 13 && code.startsWith('00000')) code = code.slice(5)
  let gtin = null
  if (code.length === 13 || code.length === 12) gtin = code.padStart(13, '0')
  else if (code.length === 8 && code.startsWith('0')) {
    const upcA = expandUpcE(code)
    if (upcA && checkDigitValid(upcA)) gtin = upcA.padStart(13, '0')
  }
  if (!gtin || !gtin.startsWith('0') || gtin.startsWith('00000') || !checkDigitValid(gtin)) return null
  return gtin
}

// --- Matching ---

function words(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/caffeine[\s-]*free/g, ' caffeinefree ')
    .replace(/root\s+beer/g, ' rootbeer ')
    .replace(/zero\s+sugar/g, ' zero ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

const IGNORED_FLAVOR_WORDS = new Set(['original', 'classic', 'pure', 'and', 'the'])

function flavorTokens(soda) {
  return [...new Set(words(soda.flavor).filter((word) => !IGNORED_FLAVOR_WORDS.has(word)))]
}

function compact(text) {
  return words(text).join('')
}

function brandMatches(soda, product) {
  const raw = Array.isArray(product.brands) ? product.brands : String(product.brands ?? '').split(',')
  const brands = raw.map(compact).filter(Boolean)
  const wanted = [compact(soda.brand), ...(BRAND_ALIASES[soda.brand] ?? [])]
  return brands.some((brand) => wanted.some((want) => brand === want || brand.startsWith(want)))
}

function productName(product) {
  return product.product_name_en || product.product_name || ''
}

/** Picks the single catalog drink a product is, or null when none or several fit. */
export function matchProduct(product, sodas) {
  const name = new Set(words(productName(product)))
  if (name.size === 0) return null
  const fits = sodas.filter((soda) => {
    if (!brandMatches(soda, product)) return false
    const tokens = flavorTokens(soda)
    if (!tokens.every((token) => name.has(token))) return false
    const brand = new Set([...words(soda.brand), ...(BRAND_WORDS[soda.brand] ?? [])])
    // A name of only generic or diet/zero words ("Soda", "Diet soda") could be any drink of the
    // brand owner, so it needs a brand word or a real flavor word.
    if (![...name].some((word) => brand.has(word) || (tokens.includes(word) && !WEAK_FLAVOR_WORDS.has(word)))) return false
    return [...name].every((word) => tokens.includes(word) || brand.has(word) || isGenericWord(word))
  })
  if (fits.length !== 1) return null
  return fits[0]
}

// --- Commands ---

function readSodas() {
  return JSON.parse(readFileSync(SODAS_FILE, 'utf8'))
}

function valueOf(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function cacheDir(args) {
  return valueOf(args, '--cache') ?? join(tmpdir(), 'lunchbench-off-cache')
}

function queries(sodas) {
  const brands = [...new Set(sodas.map((soda) => soda.brand))]
  return [
    ...brands.map((brand) => ({ key: `brand-${compact(brand)}`, terms: brand })),
    ...sodas.map((soda) => ({
      key: `drink-${soda.walmart_item_id}`,
      terms: `${soda.brand} ${soda.flavor.replace(/\bOriginal\b/i, '')}`.trim(),
    })),
  ]
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function fetchAll(args) {
  const dir = cacheDir(args)
  mkdirSync(dir, { recursive: true })
  const pending = queries(readSodas()).filter((query) => !existsSync(join(dir, `${query.key}.json`)))
  console.log(`${pending.length} queries to fetch into ${dir}`)
  for (const [index, query] of pending.entries()) {
    const url = new URL(SEARCH_URL)
    url.search = new URLSearchParams({
      q: `${query.terms.replace(/[":()]/g, ' ')} countries_tags:"en:united-states"`,
      page_size: '100',
      fields: FIELDS,
    }).toString()
    let attempt = 0
    for (;;) {
      attempt += 1
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.ok) {
        const data = await res.json()
        writeFileSync(join(dir, `${query.key}.json`), JSON.stringify(data.hits ?? []))
        console.log(`[${index + 1}/${pending.length}] ${query.terms}: ${(data.hits ?? []).length}`)
        break
      }
      console.log(`[${index + 1}/${pending.length}] ${query.terms}: HTTP ${res.status}`)
      if (attempt >= 3) break
      await sleep(REQUEST_GAP_MS * 4 * attempt)
    }
    await sleep(REQUEST_GAP_MS)
  }
}

function match(args) {
  const dir = cacheDir(args)
  const sodas = readSodas()
  const products = new Map()
  for (const query of queries(sodas)) {
    const file = join(dir, `${query.key}.json`)
    if (!existsSync(file)) continue
    for (const product of JSON.parse(readFileSync(file, 'utf8'))) {
      const code = normalizeOffCode(product.code)
      if (code && !EXCLUDED_CODES.has(code)) products.set(code, product)
    }
  }

  const byDrink = new Map(sodas.map((soda) => [soda.walmart_item_id, []]))
  for (const [code, product] of products) {
    const soda = matchProduct(product, sodas)
    if (!soda) continue
    byDrink.get(soda.walmart_item_id).push({
      code,
      product_name: productName(product),
      quantity: product.quantity ?? '',
    })
  }

  const out = {}
  for (const soda of sodas) {
    const codes = byDrink.get(soda.walmart_item_id).sort((a, b) => a.code.localeCompare(b.code))
    out[soda.walmart_item_id] = { name: `${soda.brand} ${soda.flavor}`, codes }
  }
  writeFileSync(BARCODES_FILE, `${JSON.stringify(out, null, 2)}\n`)
  const covered = Object.values(out).filter((entry) => entry.codes.length > 0).length
  const total = Object.values(out).reduce((sum, entry) => sum + entry.codes.length, 0)
  console.log(`${covered}/${sodas.length} drinks have at least one code (${total} codes). Wrote ${BARCODES_FILE}`)
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function writeSql() {
  const data = JSON.parse(readFileSync(BARCODES_FILE, 'utf8'))
  const rows = []
  for (const [itemId, entry] of Object.entries(data)) {
    for (const { code } of entry.codes) {
      if (normalizeOffCode(code) !== code) throw new Error(`Bad code ${code} for ${itemId}`)
      rows.push(`  (${sqlString(code)}, ${sqlString(itemId)})`)
    }
  }
  const sql = [
    '-- Sodabench barcode seed: retail UPC/EAN codes for catalog drinks, from Open Food Facts.',
    '-- Generated by `node scripts/import-barcodes.mjs sql` from scripts/data/soda-barcodes.json. Do not edit by hand.',
    '-- Data only. Safe to re-run: INSERT OR IGNORE keyed by code, and drinks are found by walmart_item_id.',
    '-- A drink missing from `sodas` (local seed has 14 of 124) is skipped.',
    'INSERT OR IGNORE INTO soda_barcodes (code, soda_id, source)',
    'SELECT seed.code, sodas.id, \'seed\'',
    'FROM (',
    '  SELECT column1 AS code, column2 AS walmart_item_id FROM (VALUES',
    rows.join(',\n'),
    '  )',
    ') AS seed',
    'JOIN sodas ON sodas.walmart_item_id = seed.walmart_item_id;',
    '',
  ].join('\n')
  writeFileSync(MIGRATION_FILE, sql)
  console.log(`Wrote ${rows.length} codes to ${MIGRATION_FILE}`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'fetch') await fetchAll(args)
  else if (command === 'match') match(args)
  else if (command === 'sql') writeSql()
  else {
    console.error('Usage: node scripts/import-barcodes.mjs fetch|match|sql [--cache DIR]')
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
