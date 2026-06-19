const MAX_SIZE = 5 * 1024 * 1024

export async function validateImageFile(
  file: File
): Promise<{ valid: boolean; error?: string }> {
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File must be 5MB or smaller.' }
  }

  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedMimes.includes(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, and WebP images are allowed.' }
  }

  const buf = await file.slice(0, 12).arrayBuffer()
  const bytes = new Uint8Array(buf)

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true }
  }

  // PNG
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { valid: true }
  }

  // WebP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { valid: true }
  }

  return { valid: false, error: 'File does not appear to be a valid image. Check the file and try again.' }
}
