/// <reference types="emscripten" />
// Fallback barcode decoder (ZXing C++ compiled to WebAssembly) for browsers without BarcodeDetector,
// notably iOS Safari. Loaded with a dynamic import only when scanning starts.
// The .wasm file is bundled by Vite and served from our own origin, never from a CDN
// (zxing-wasm defaults to jsDelivr, so locateFile is overridden). Needs CSP 'wasm-unsafe-eval'.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export type DecodedBarcode = { rawValue: string; format: string }

const overrides = {
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
}

/** Loads and compiles the WebAssembly module. Rejects when the browser or CSP blocks it. */
export async function initZxing(): Promise<void> {
  await prepareZXingModule({ overrides, fireImmediately: true })
}

/** `tryHarder` is the slower, more thorough pass; the scanner alternates it to keep frames cheap. */
export async function decodeImageData(image: ImageData, tryHarder: boolean): Promise<DecodedBarcode[]> {
  const results = await readBarcodes(image, {
    formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
    tryHarder,
    maxNumberOfSymbols: 1,
  })
  return results
    .filter((result) => result.isValid)
    .map((result) => ({ rawValue: result.text, format: result.format }))
}
