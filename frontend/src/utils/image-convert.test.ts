import { describe, expect, test } from 'vitest'
import { detectContainerFormat } from './image-convert'

function bmff(brand: string): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    ...brand.split('').map((char) => char.charCodeAt(0)),
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
})
