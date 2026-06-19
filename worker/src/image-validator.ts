export type ImageValidationResult =
  | { valid: true; ext: string; contentType: string }
  | { valid: false; error: string; status: 413 | 415 }

const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export function validateImageBuffer(
  buf: ArrayBuffer,
  declaredSize: number
): ImageValidationResult {
  if (declaredSize > MAX_SIZE) {
    return { valid: false, error: 'File exceeds 5MB limit', status: 413 }
  }

  if (buf.byteLength > MAX_SIZE) {
    return { valid: false, error: 'File exceeds 5MB limit', status: 413 }
  }

  const bytes = new Uint8Array(buf.slice(0, 12))

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
    return validImage('jpg', 'image/jpeg')
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return validImage('png', 'image/png')
  }

  // WebP: RIFF????WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return validImage('webp', 'image/webp')
  }

  return { valid: false, error: 'Unsupported image format. Use JPEG, PNG, or WebP.', status: 415 }
}
