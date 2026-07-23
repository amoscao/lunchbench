export type ContainerImageFormat = 'heic' | 'avif' | null

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end))
}

export function detectContainerFormat(bytes: Uint8Array): ContainerImageFormat {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') {
    return null
  }

  const brand = ascii(bytes, 8, 12)
  if (HEIC_BRANDS.has(brand)) return 'heic'
  if (AVIF_BRANDS.has(brand)) return 'avif'
  return null
}

export async function detectFileContainerFormat(file: File): Promise<ContainerImageFormat> {
  const buf = await file.slice(0, 12).arrayBuffer()
  return detectContainerFormat(new Uint8Array(buf))
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
