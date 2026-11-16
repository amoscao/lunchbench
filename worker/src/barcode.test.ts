import { describe, expect, test } from 'vitest'
import { expandUpcE, gtinCheckDigitValid, isBarcodeFormat, normalizeBarcode } from './barcode'

describe('barcode normalization', () => {
  test('validates GTIN check digits', () => {
    expect(gtinCheckDigitValid('049000006346')).toBe(true) // Coca-Cola 12 oz can, UPC-A
    expect(gtinCheckDigitValid('0049000006346')).toBe(true) // same, zero-padded
    expect(gtinCheckDigitValid('5449000000996')).toBe(true) // EAN-13
    expect(gtinCheckDigitValid('96385074')).toBe(true) // EAN-8
    expect(gtinCheckDigitValid('049000006347')).toBe(false)
    expect(gtinCheckDigitValid('12a4')).toBe(false)
  })

  test('expands UPC-E to UPC-A for every last-digit rule', () => {
    expect(expandUpcE('04963406')).toBe('049000006346') // d6 0-2
    expect(expandUpcE('01234531')).toBe('012300000451') // d6 3
    expect(expandUpcE('01234548')).toBe('012340000058') // d6 4
    expect(expandUpcE('01234565')).toBe('012345000065') // d6 5-9
    expect(expandUpcE('21234565')).toBeNull() // number system must be 0 or 1
    expect(expandUpcE('0123456')).toBeNull()
  })

  test('normalizes every format to a 13-digit GTIN', () => {
    expect(normalizeBarcode('049000006346', 'upc_a')).toBe('0049000006346')
    expect(normalizeBarcode('04963406', 'upc_e')).toBe('0049000006346')
    expect(normalizeBarcode('0049000006346', 'ean_13')).toBe('0049000006346')
    expect(normalizeBarcode('96385074', 'ean_8')).toBe('0000096385074')
    expect(normalizeBarcode(' 5449000000996 ')).toBe('5449000000996')
    // Format only matters for 8 digits; without it they are EAN-8.
    expect(normalizeBarcode('049000006346')).toBe('0049000006346')
    expect(normalizeBarcode('96385074')).toBe('0000096385074')
  })

  test('rejects bad check digits, lengths, characters and all zeros', () => {
    expect(normalizeBarcode('049000006347', 'upc_a')).toBeNull()
    expect(normalizeBarcode('04963407', 'upc_e')).toBeNull()
    expect(normalizeBarcode('04963406', 'ean_8')).toBeNull()
    expect(normalizeBarcode('12345', null)).toBeNull()
    expect(normalizeBarcode('00490000063460')).toBeNull()
    expect(normalizeBarcode('04900000634x')).toBeNull()
    expect(normalizeBarcode('0000000000000')).toBeNull()
    expect(normalizeBarcode(49000006346)).toBeNull()
    expect(normalizeBarcode('data:image/png;base64,AAAA')).toBeNull()
  })

  test('accepts only retail formats', () => {
    expect(isBarcodeFormat('upc_e')).toBe(true)
    expect(isBarcodeFormat('qr_code')).toBe(false)
    expect(isBarcodeFormat(undefined)).toBe(false)
  })
})
