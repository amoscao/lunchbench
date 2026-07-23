import { describe, expect, test } from 'vitest'
import { detectContainerFormat } from './image-convert'

function bytesOf(str: string): number[] {
  return str.split('').map((char) => char.charCodeAt(0))
}

function bmff(majorBrand: string, compatibleBrands: string[] = []): Uint8Array {
  const size = 16 + compatibleBrands.length * 4
  return new Uint8Array([
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    ...bytesOf('ftyp'),
    ...bytesOf(majorBrand),
    0x00, 0x00, 0x00, 0x00, // minor version
    ...compatibleBrands.flatMap(bytesOf),
  ])
}

describe('detectContainerFormat', () => {
  test.each(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])(
    'detects %s as HEIC/HEIF',
    (brand) => {
      expect(detectContainerFormat(bmff(brand))).toBe('heic')
    }
  )

  test.each(['avif', 'avis'])('detects %s as AVIF', (brand) => {
    expect(detectContainerFormat(bmff(brand))).toBe('avif')
  })

  test('rejects non-BMFF bytes', () => {
    expect(detectContainerFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
  })

  test('rejects unknown BMFF brands', () => {
    expect(detectContainerFormat(bmff('mp42'))).toBeNull()
  })

  test('detects HEIC via compatible brand when major brand is generic', () => {
    expect(detectContainerFormat(bmff('isom', ['heic', 'miaf']))).toBe('heic')
  })

  test('detects AVIF via compatible brand when major brand is generic', () => {
    expect(detectContainerFormat(bmff('isom', ['miaf', 'avif']))).toBe('avif')
  })

  test('rejects when neither major nor compatible brands match', () => {
    expect(detectContainerFormat(bmff('isom', ['miaf', 'mp42']))).toBeNull()
  })
})
