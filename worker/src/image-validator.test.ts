import { describe, expect, test } from 'vitest'
import { validateImageBuffer } from './image-validator'

function jpegBuffer(length = 100): ArrayBuffer {
  const bytes = new Uint8Array(length)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[length - 2] = 0xff
  bytes[length - 1] = 0xd9
  return bytes.buffer
}

function pngBuffer(length = 100): ArrayBuffer {
  const bytes = new Uint8Array(length)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x45, 0x4e, 0x44], length - 8)
  return bytes.buffer
}

function webpBuffer(length = 100): ArrayBuffer {
  const bytes = new Uint8Array(length)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  new DataView(bytes.buffer).setUint32(4, length - 8, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  return bytes.buffer
}

describe('validateImageBuffer', () => {
  test('rejects files smaller than 100 bytes', () => {
    const buf = jpegBuffer(99)

    expect(validateImageBuffer(buf, 99)).toEqual({
      valid: false,
      error: 'File is too small to be a valid image',
      status: 415,
    })
  })

  test('accepts JPEG only when it has an end marker', () => {
    expect(validateImageBuffer(jpegBuffer(), 100)).toEqual({
      valid: true,
      ext: 'jpg',
      contentType: 'image/jpeg',
    })

    const spoofed = new Uint8Array(jpegBuffer())
    spoofed[98] = 0x00
    spoofed[99] = 0x00

    expect(validateImageBuffer(spoofed.buffer, spoofed.byteLength)).toEqual({
      valid: false,
      error: 'Invalid JPEG image',
      status: 415,
    })
  })

  test('accepts PNG only when IEND exists near the end', () => {
    expect(validateImageBuffer(pngBuffer(), 100)).toEqual({
      valid: true,
      ext: 'png',
      contentType: 'image/png',
    })

    const spoofed = new Uint8Array(pngBuffer())
    spoofed.set([0x00, 0x00, 0x00, 0x00], 92)

    expect(validateImageBuffer(spoofed.buffer, spoofed.byteLength)).toEqual({
      valid: false,
      error: 'Invalid PNG image',
      status: 415,
    })
  })

  test('accepts WebP only when RIFF chunk size matches file length', () => {
    expect(validateImageBuffer(webpBuffer(), 100)).toEqual({
      valid: true,
      ext: 'webp',
      contentType: 'image/webp',
    })

    const spoofed = new Uint8Array(webpBuffer())
    new DataView(spoofed.buffer).setUint32(4, 1, true)

    expect(validateImageBuffer(spoofed.buffer, spoofed.byteLength)).toEqual({
      valid: false,
      error: 'Invalid WebP image',
      status: 415,
    })
  })
})
