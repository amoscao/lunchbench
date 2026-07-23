export type ContainerImageFormat = 'heic' | 'avif' | null

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
