import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Soda } from '../api'
import {
  expandUpcE,
  gtinCheckDigitValid,
  loadBarcodeMap,
  lookupBarcode,
  normalizeBarcode,
  rememberBarcode,
  resetBarcodeMapForTests,
  toBarcodeFormat,
} from './barcode'

function soda(id: number, name: string): Soda {
  return { id, brand: name.split(' ')[0], flavor: 'Original', name, type: 'soda', image_url: null }
}

describe('barcode normalization (same cases as the worker)', () => {
  test('validates check digits', () => {
    expect(gtinCheckDigitValid('049000006346')).toBe(true)
    expect(gtinCheckDigitValid('5449000000996')).toBe(true)
    expect(gtinCheckDigitValid('96385074')).toBe(true)
    expect(gtinCheckDigitValid('049000006347')).toBe(false)
  })

  test('expands UPC-E', () => {
    expect(expandUpcE('04963406')).toBe('049000006346')
    expect(expandUpcE('01234531')).toBe('012300000451')
    expect(expandUpcE('01234548')).toBe('012340000058')
    expect(expandUpcE('01234565')).toBe('012345000065')
    expect(expandUpcE('21234565')).toBeNull()
  })

  test('normalizes UPC-E, UPC-A, EAN-8 and EAN-13 to 13 digits', () => {
    expect(normalizeBarcode('04963406', 'upc_e')).toBe('0049000006346')
    expect(normalizeBarcode('049000006346', 'upc_a')).toBe('0049000006346')
    expect(normalizeBarcode('0049000006346', 'ean_13')).toBe('0049000006346')
    expect(normalizeBarcode('96385074', 'ean_8')).toBe('0000096385074')
  })

  test('rejects bad check digits and non-retail shapes', () => {
    expect(normalizeBarcode('04963407', 'upc_e')).toBeNull()
    expect(normalizeBarcode('049000006347', 'upc_a')).toBeNull()
    expect(normalizeBarcode('https://example.com', null)).toBeNull()
    expect(normalizeBarcode('0000000000000')).toBeNull()
  })

  test('maps decoder format names', () => {
    expect(toBarcodeFormat('upc_e')).toBe('upc_e')
    expect(toBarcodeFormat('UPCA')).toBe('upc_a')
    expect(toBarcodeFormat('EAN-13')).toBe('ean_13')
    expect(toBarcodeFormat('EAN8')).toBe('ean_8')
    expect(toBarcodeFormat('qr_code')).toBeNull()
  })
})

describe('barcode lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetBarcodeMapForTests()
  })

  test('finds catalog drinks by normalized code', () => {
    const catalog = new Map([[1, soda(1, 'Coca-Cola Original')]])
    const map = new Map([['0049000006346', 1], ['0012345678905', 99]])
    expect(lookupBarcode(map, '0049000006346', catalog)?.name).toBe('Coca-Cola Original')
    expect(lookupBarcode(map, '0012345678905', catalog)).toBeNull() // mapped to a drink not in the catalog
    expect(lookupBarcode(map, '0098765432105', catalog)).toBeNull()
  })

  test('fetches the list once and remembers learned codes locally', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ barcodes: [{ code: '0049000006346', soda_id: 1 }] })))
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadBarcodeMap()
    await loadBarcodeMap()
    rememberBarcode('0012345678905', 2)
    const after = await loadBarcodeMap()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.get('0049000006346')).toBe(1)
    expect(after.get('0012345678905')).toBe(2)
  })

  test('retries the list after a failed fetch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ barcodes: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadBarcodeMap()).rejects.toThrow()
    await expect(loadBarcodeMap()).resolves.toEqual(new Map())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('barcode API bodies', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('unknown-scan log sends only the code and format; reports add the barcode only when given', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true }))
    }))
    const { logUnknownScan, submitSodaReport } = await import('../api')

    await logUnknownScan('0012345678905', 'upc_a')
    await submitSodaReport(3, 'like')
    await submitSodaReport(3, 'hate', '0012345678905')

    expect(bodies).toEqual([
      { barcode: '0012345678905', format: 'upc_a' },
      { soda_id: 3, verdict: 'like' },
      { soda_id: 3, verdict: 'hate', barcode: '0012345678905' },
    ])
  })
})
