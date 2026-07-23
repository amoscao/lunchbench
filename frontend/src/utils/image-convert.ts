export type ContainerImageFormat = 'heic' | 'avif' | null

export const PRE_CROP_MAX_IMAGE_DIMENSION = 2000
const PRE_CROP_JPEG_QUALITY = 0.85
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis'])
const FTYP_SNIFF_BYTES = 128

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (end > bytes.length) return ''
  return String.fromCharCode(...bytes.slice(start, end))
}

function brandFormat(brand: string): ContainerImageFormat {
  if (HEIC_BRANDS.has(brand)) return 'heic'
  if (AVIF_BRANDS.has(brand)) return 'avif'
  return null
}

// ISO-BMFF ftyp box: 4-byte size, 'ftyp', 4-byte major brand, 4-byte minor version,
// then a list of 4-byte compatible brands filling out the rest of the box.
export function detectContainerFormat(bytes: Uint8Array): ContainerImageFormat {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') {
    return null
  }

  const majorFormat = brandFormat(ascii(bytes, 8, 12))
  if (majorFormat) return majorFormat

  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  const end = Math.min(boxSize || bytes.length, bytes.length)
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const format = brandFormat(ascii(bytes, offset, offset + 4))
    if (format) return format
  }

  return null
}

export async function detectFileContainerFormat(file: File): Promise<ContainerImageFormat> {
  const buf = await file.slice(0, FTYP_SNIFF_BYTES).arrayBuffer()
  return detectContainerFormat(new Uint8Array(buf))
}

export async function canDecodeImage(file: File): Promise<boolean> {
  if (typeof createImageBitmap !== 'function') return true
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
    return true
  } catch {
    return false
  }
}

export async function convertHeicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  })
  const blob = Array.isArray(converted) ? converted[0] : converted
  const basename = file.name.replace(/\.[^.]+$/, '') || 'image'

  return new File([blob], `${basename}.jpg`, {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  })
}

export function fitImageDimensions(
  width: number,
  height: number,
  maxDimension = PRE_CROP_MAX_IMAGE_DIMENSION
): { width: number; height: number; resized: boolean } {
  const longestSide = Math.max(width, height)
  if (longestSide <= maxDimension) {
    return { width, height, resized: false }
  }

  const scale = maxDimension / longestSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  }
}

export async function resizeImageForCrop(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file

  const bitmap = await createImageBitmap(file)
  try {
    const dimensions = fitImageDimensions(bitmap.width, bitmap.height)
    if (!dimensions.resized) return file

    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not resize image.')

    ctx.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((resizedBlob) => {
        if (!resizedBlob) {
          reject(new Error('Could not resize image.'))
          return
        }
        resolve(resizedBlob)
      }, 'image/jpeg', PRE_CROP_JPEG_QUALITY)
    })

    const basename = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${basename}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } finally {
    bitmap.close()
  }
}
