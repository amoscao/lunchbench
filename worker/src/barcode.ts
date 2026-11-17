// Retail barcode normalization. Same rules as frontend/src/utils/barcode.ts; keep them in sync.
//
// Every code is stored and compared as a 13-digit GTIN:
// - UPC-E (8 digits) is expanded to UPC-A (12 digits);
// - UPC-A and EAN-8 are zero-padded on the left to 13 digits;
// - the GTIN check digit must be valid.

export const BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number]

export function isBarcodeFormat(value: unknown): value is BarcodeFormat {
  return typeof value === 'string' && (BARCODE_FORMATS as readonly string[]).includes(value)
}

/** GTIN check digit: weights 3, 1, 3, … from the digit left of the check digit. */
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

/** UPC-E (number system 0 or 1, six digits, check digit) to UPC-A. Null when not a UPC-E shape. */
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

/**
 * Normalizes a decoded barcode to a 13-digit GTIN, or null when it is not a valid UPC/EAN.
 * `format` only matters below 12 digits: `upc_e` codes (6-8 digits, see completeUpcE) are expanded;
 * other 8-digit codes are EAN-8.
 */
export function normalizeBarcode(raw: unknown, format?: BarcodeFormat | null): string | null {
  if (typeof raw !== 'string') return null
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
