export type ImageValidationResult =
  | { valid: true; ext: string; contentType: string }
  | { valid: false; error: string; status: 413 | 415 }

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const MIN_IMAGE_SIZE_BYTES = 100 // app-level policy floor; not a strict PNG/JPEG/WebP validity requirement

export function validateImageBuffer(
  buf: ArrayBuffer,
  declaredSize: number
): ImageValidationResult {
  if (declaredSize > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds 5MB limit', status: 413 }
  }

  if (buf.byteLength > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds 5MB limit', status: 413 }
  }

  if (declaredSize < MIN_IMAGE_SIZE_BYTES || buf.byteLength < MIN_IMAGE_SIZE_BYTES) {
    return { valid: false, error: 'File is too small to be a valid image', status: 415 }
  }

  const fileBytes = new Uint8Array(buf)
  const bytes = fileBytes.slice(0, 12)

  const validImage = (ext: string, contentType: string): ImageValidationResult => {
    const textView = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(buf.slice(0, 100))
    const forbidden = ['<script', '<?php', '<%', '<!DOCTYPE', '<html']
    for (const pattern of forbidden) {
      if (textView.toLowerCase().includes(pattern)) {
        return { valid: false, error: 'File contains suspicious content', status: 415 }
      }
    }

    return { valid: true, ext, contentType }
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    if (fileBytes[fileBytes.length - 2] !== 0xff || fileBytes[fileBytes.length - 1] !== 0xd9) {
      return { valid: false, error: 'Invalid JPEG image', status: 415 }
    }
    return validImage('jpg', 'image/jpeg')
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    const iendOffset = fileBytes.length - 8
    if (
      fileBytes[iendOffset] !== 0x49 ||
      fileBytes[iendOffset + 1] !== 0x45 ||
      fileBytes[iendOffset + 2] !== 0x4e ||
      fileBytes[iendOffset + 3] !== 0x44
    ) {
      return { valid: false, error: 'Invalid PNG image', status: 415 }
    }
    return validImage('png', 'image/png')
  }

  // WebP: RIFF????WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const riffSize = new DataView(buf).getUint32(4, true) + 8
    if (riffSize !== buf.byteLength) {
      return { valid: false, error: 'Invalid WebP image', status: 415 }
    }
    return validImage('webp', 'image/webp')
  }

  return { valid: false, error: 'Unsupported image format. Use JPEG, PNG, or WebP.', status: 415 }
}
