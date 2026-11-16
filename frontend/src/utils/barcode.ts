import { getSodaBarcodes, type Soda } from '../api'

// Retail barcode normalization. Same rules as worker/src/barcode.ts; keep them in sync.
// Every code is a 13-digit GTIN: UPC-E expanded to UPC-A, UPC-A and EAN-8 zero-padded, check digit valid.

export const BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number]

/** GTIN check digit for `body` (all digits except the check digit). */
export function gtinCheckDigit(body: string): string {
  let sum = 0
  let weight = 3
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return String((10 - (sum % 10)) % 10)
}

export function gtinCheckDigitValid(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) return false
  let sum = 0
  let weight = 3
  for (let i = digits.length - 2; i >= 0; i -= 1) {
    sum += Number(digits[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const ns = code[0]
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7)
  let body: string
  if (d6 <= '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return `${ns}${body}${code[7]}`
}

/**
 * A UPC-E as a decoder may report it, completed to the full 8 digits (number system, six digits,
 * check digit). Some native decoders drop the number system and/or the check digit:
 * - 8 digits: as is;
 * - 7 digits: six digits + check with number system 0 if that check is valid, else number system
 *   (0 or 1) + six digits, check digit computed;
 * - 6 digits: number system 0, check digit computed.
 * A computed check digit cannot catch a misread; only the decoder's own check protects those.
 */
export function completeUpcE(code: string): string | null {
  if (!/^\d{6,8}$/.test(code)) return null
  const withCheck = (nsAndSix: string): string | null => {
    const upcA = expandUpcE(`${nsAndSix}0`)
    return upcA ? `${nsAndSix}${gtinCheckDigit(upcA.slice(0, 11))}` : null
  }
  if (code.length === 8) return code
  if (code.length === 6) return withCheck(`0${code}`)
  const zeroNs = expandUpcE(`0${code}`)
  if (zeroNs && gtinCheckDigitValid(zeroNs)) return `0${code}`
  return withCheck(code)
}

/** 13-digit GTIN, or null when not a valid UPC/EAN. `format` only matters below 12 digits (UPC-E vs EAN-8). */
export function normalizeBarcode(raw: string, format?: BarcodeFormat | null): string | null {
  const code = raw.trim()
  if (!/^\d+$/.test(code)) return null
  let gtin: string | null = null
  if (code.length === 13) gtin = code
  else if (code.length === 12) gtin = `0${code}`
  else if (format === 'upc_e') {
    const full = completeUpcE(code)
    const upcA = full ? expandUpcE(full) : null
    gtin = upcA ? `0${upcA}` : null
  } else if (code.length === 8) gtin = code.padStart(13, '0')
  if (!gtin || /^0+$/.test(gtin) || !gtinCheckDigitValid(gtin)) return null
  return gtin
}

/** Decoder format names (BarcodeDetector `upc_a`, ZXing `UPCA`/`UPC-A`) to ours. Null for anything else. */
export function toBarcodeFormat(format: string): BarcodeFormat | null {
  const key = format.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (key === 'upca') return 'upc_a'
  if (key === 'upce') return 'upc_e'
  if (key === 'ean13') return 'ean_13'
  if (key === 'ean8') return 'ean_8'
  return null
}

export type BarcodeMap = Map<string, number>

/** The drink a normalized code maps to, if it is in the catalog. */
export function lookupBarcode(map: BarcodeMap, code: string, catalog: Map<number, Soda>): Soda | null {
  const sodaId = map.get(code)
  return sodaId === undefined ? null : catalog.get(sodaId) ?? null
}

// Fetched once per page load, then looked up locally: no request per scan.
let barcodeMap: Promise<BarcodeMap> | null = null

export function loadBarcodeMap(): Promise<BarcodeMap> {
  barcodeMap ??= getSodaBarcodes()
    .then((rows) => new Map(rows.map((row) => [row.code, row.soda_id])))
    .catch((error: unknown) => {
      barcodeMap = null
      throw error
    })
  return barcodeMap
}

/** Records a mapping the server just learned, so a re-scan on this page matches. */
export function rememberBarcode(code: string, sodaId: number): void {
  if (!barcodeMap) return
  barcodeMap = barcodeMap.then((map) => map.set(code, sodaId))
}

export function resetBarcodeMapForTests(): void {
  barcodeMap = null
}
