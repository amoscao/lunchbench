import { afterEach, describe, expect, test, vi } from 'vitest'
import { detectContainerFormat, fitImageDimensions, resizeImageForCrop } from './image-convert'

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

describe('fitImageDimensions', () => {
  test('keeps images within the max dimension unchanged', () => {
    expect(fitImageDimensions(1600, 1200, 2000)).toEqual({
      width: 1600,
      height: 1200,
      resized: false,
    })
  })

  test('scales landscape images to the max dimension', () => {
    expect(fitImageDimensions(4000, 3000, 2000)).toEqual({
      width: 2000,
      height: 1500,
      resized: true,
    })
  })

  test('scales portrait images to the max dimension', () => {
    expect(fitImageDimensions(3000, 4000, 2000)).toEqual({
      width: 1500,
      height: 2000,
      resized: true,
    })
  })
})

describe('resizeImageForCrop', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns the original file when no browser decoder is available', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const file = new File(['image'], 'lunch.jpg', { type: 'image/jpeg' })

    await expect(resizeImageForCrop(file)).resolves.toBe(file)
  })

  test('returns the original file when the bitmap is already within the cap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1200, height: 900, close }))
    const file = new File(['image'], 'lunch.jpg', { type: 'image/jpeg' })

    await expect(resizeImageForCrop(file)).resolves.toBe(file)
    expect(close).toHaveBeenCalled()
  })

  test('re-encodes oversized images as capped JPEGs', async () => {
    const close = vi.fn()
    const drawImage = vi.fn()
    const toBlob = vi.fn((callback: BlobCallback, type: string, quality: number) => {
      callback(new Blob(['resized'], { type }))
      expect(quality).toBe(0.85)
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob,
    }

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }))
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })

    const file = new File(['image'], 'lunch.png', { type: 'image/png', lastModified: 123 })
    const resized = await resizeImageForCrop(file)

    expect(resized).not.toBe(file)
    expect(resized.name).toBe('lunch.jpg')
    expect(resized.type).toBe('image/jpeg')
    expect(resized.lastModified).toBe(123)
    expect(canvas.width).toBe(2000)
    expect(canvas.height).toBe(1500)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500)
    expect(close).toHaveBeenCalled()
  })
})
