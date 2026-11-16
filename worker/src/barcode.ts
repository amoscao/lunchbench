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
 * Normalizes a decoded barcode to a 13-digit GTIN, or null when it is not a valid UPC/EAN.
 * `format` only matters for 8 digits, which are UPC-E when the decoder says so and EAN-8 otherwise.
 */
export function normalizeBarcode(raw: unknown, format?: BarcodeFormat | null): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim()
  if (!/^\d+$/.test(code)) return null

  let gtin: string | null = null
  if (code.length === 13) gtin = code
  else if (code.length === 12) gtin = `0${code}`
  else if (code.length === 8) {
    const upcA = format === 'upc_e' ? expandUpcE(code) : code
    gtin = upcA ? upcA.padStart(13, '0') : null
  }

  if (!gtin || /^0+$/.test(gtin) || !gtinCheckDigitValid(gtin)) return null
  return gtin
}
