// Writes Y4M clips for Chromium's fake camera (--use-file-for-fake-video-capture).
// A clip is a still UPC-A barcode, black on white, so the real decoder runs on real camera frames.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** UPC-A on the "known" clip: Coca-Cola 12 oz can. E2E maps it to Coca-Cola Original first. */
export const KNOWN_BARCODE = '049000006346'
export const KNOWN_GTIN = '0049000006346'
/** UPC-A on the "unknown" clip. Valid check digit, not a real product, never seeded. */
export const UNKNOWN_BARCODE = '012345678905'
export const UNKNOWN_GTIN = '0012345678905'

const WIDTH = 640
const HEIGHT = 480
const MODULE_PX = 4
const FRAMES = 2

const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const R_CODES = L_CODES.map((code) => [...code].map((bit) => (bit === '1' ? '0' : '1')).join(''))

/** 95-module UPC-A pattern for a 12-digit code (check digit included). */
export function upcAModules(code: string): string {
  if (!/^\d{12}$/.test(code)) throw new Error(`UPC-A needs 12 digits: ${code}`)
  const digits = [...code].map(Number)
  return [
    '101',
    ...digits.slice(0, 6).map((digit) => L_CODES[digit]),
    '01010',
    ...digits.slice(6).map((digit) => R_CODES[digit]),
    '101',
  ].join('')
}

function lumaPlane(modules: string | null): Buffer {
  const plane = Buffer.alloc(WIDTH * HEIGHT, 235)
  if (!modules) return plane
  const barsWidth = modules.length * MODULE_PX
  const left = Math.floor((WIDTH - barsWidth) / 2)
  const top = Math.floor(HEIGHT * 0.3)
  const bottom = Math.floor(HEIGHT * 0.7)
  for (let y = top; y < bottom; y += 1) {
    for (let m = 0; m < modules.length; m += 1) {
      if (modules[m] !== '1') continue
      const x0 = left + m * MODULE_PX
      plane.fill(16, y * WIDTH + x0, y * WIDTH + x0 + MODULE_PX)
    }
  }
  return plane
}

/** Writes `<dir>/<name>.y4m` showing `code` (or a blank white frame when null) and returns its path. */
export function writeBarcodeClip(dir: string, name: string, code: string | null): string {
  mkdirSync(dir, { recursive: true })
  const luma = lumaPlane(code ? upcAModules(code) : null)
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2) * 2, 128)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma])
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`)
  const path = join(dir, `${name}.y4m`)
  writeFileSync(path, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]))
  return path
}
