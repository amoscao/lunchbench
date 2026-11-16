import { logUnknownScan, type Soda } from '../api'
import {
  BARCODE_FORMATS,
  loadBarcodeMap,
  lookupBarcode,
  normalizeBarcode,
  toBarcodeFormat,
} from '../utils/barcode'
import { escapeHtml } from '../utils/escape-html'

// Decoding runs on the device. Frames go from the <video> to the decoder and nowhere else:
// the only thing sent to the server is the decoded digit string (and its symbology) of an unknown code.

const SCAN_INTERVAL_MS = 120
// ZXing runs on the main thread. Frames are downscaled to this long side, and the slower
// `tryHarder` pass runs on every other frame only, so older iPhones stay responsive.
// 960px still gives a 12 oz can barcode filling the scan frame ~3px per module.
const MAX_DECODE_LONG_SIDE = 960

type DecodedBarcode = { rawValue: string; format: string }
type Detector = { detect: (video: HTMLVideoElement) => Promise<DecodedBarcode[]> }

type NativeBarcodeDetector = {
  new (options: { formats: string[] }): { detect: (source: CanvasImageSource) => Promise<DecodedBarcode[]> }
  getSupportedFormats: () => Promise<string[]>
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/** Scan mode is the default only on touch-first devices (phones, tablets). Desktop opens in manual mode. */
export function prefersScanMode(): boolean {
  return cameraSupported() && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
}

/** Native BarcodeDetector when it reads retail formats (Chrome on Android), else the lazy ZXing build. */
async function createDetector(): Promise<Detector | null> {
  const Native = (window as unknown as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      const formats = BARCODE_FORMATS.filter((format) => supported.includes(format))
      if (formats.length > 0) {
        const detector = new Native({ formats })
        return { detect: (video) => detector.detect(video) }
      }
    } catch {
      // Fall through to ZXing.
    }
  }
  try {
    const zxing = await import('../utils/zxing-decoder')
    await zxing.initZxing()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    let attempt = 0
    return {
      async detect(video) {
        const scale = Math.min(1, MAX_DECODE_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        attempt += 1
        return zxing.decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height), attempt % 2 === 0)
      },
    }
  } catch {
    return null
  }
}

/** An unknown code, already sent to the unknown-scan log (`logged` settles when that request does). */
export type UnknownScan = { code: string; logged: Promise<void> }

export type ScanPanelHandlers = {
  /** A catalog drink was scanned. The camera is already off; the panel shows the drink. */
  onMatch: (soda: Soda) => void
  /** Switch to manual search. `unknown` is set when the scan matched no drink. */
  onManual: (unknown: UnknownScan | null) => void
  /** No camera, permission denied, no decoder, or the page was hidden. `retryable` is true only for hidden. */
  onUnavailable: (retryable: boolean) => void
}

export type ScanPanel = { stop: () => void }

/**
 * Mounts the scanner into `container`: live rear-camera preview, scan frame, "Select manually".
 * `stop()` turns the camera off (every track) and is safe to call more than once.
 * The panel also turns the camera off itself on a decode, on errors and when the page is hidden.
 */
export function mountScanPanel(container: HTMLElement, catalog: Soda[], handlers: ScanPanelHandlers): ScanPanel {
  const byId = new Map(catalog.map((soda) => [soda.id, soda]))
  let stream: MediaStream | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let cameraOff = false
  let destroyed = false

  container.innerHTML = `
    <div class="barcode-scan">
      <div class="barcode-scan-view">
        <video class="barcode-scan-video" playsinline muted autoplay aria-label="Camera"></video>
        <div class="barcode-scan-frame" aria-hidden="true"></div>
      </div>
      <button type="button" class="btn btn-secondary barcode-scan-manual">Select manually</button>
    </div>
  `
  const view = container.querySelector<HTMLElement>('.barcode-scan-view')!
  const video = container.querySelector<HTMLVideoElement>('.barcode-scan-video')!
  const manualBtn = container.querySelector<HTMLButtonElement>('.barcode-scan-manual')!

  function stopCamera(): void {
    cameraOff = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.pause()
    video.srcObject = null
  }

  function stop(): void {
    destroyed = true
    stopCamera()
  }

  function fail(retryable: boolean): void {
    if (destroyed) return
    stop()
    handlers.onUnavailable(retryable)
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') fail(true)
  }

  function showMatch(soda: Soda): void {
    view.outerHTML = `
      <div class="barcode-scan-match">
        ${soda.image_url ? `<img src="${escapeHtml(soda.image_url)}" alt="" />` : '<span class="barcode-scan-noimg"></span>'}
        <span class="barcode-scan-name">${escapeHtml(soda.name)}</span>
      </div>
    `
  }

  async function handleCode(code: string, format: string): Promise<void> {
    stopCamera()
    const map = await loadBarcodeMap().catch(() => null)
    if (destroyed) return
    if (!map) {
      // Without the list we cannot tell known from unknown, so do not log it.
      stop()
      handlers.onManual(null)
      return
    }
    const soda = lookupBarcode(map, code, byId)
    if (soda) {
      showMatch(soda)
      handlers.onMatch(soda)
      return
    }
    stop()
    handlers.onManual({ code, logged: logUnknownScan(code, format).catch(() => undefined) })
  }

  async function scanLoop(detector: Detector): Promise<void> {
    timer = null
    if (cameraOff) return
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      try {
        for (const result of await detector.detect(video)) {
          const format = toBarcodeFormat(result.format)
          const code = format ? normalizeBarcode(result.rawValue, format) : null
          if (format && code && !cameraOff) {
            void handleCode(code, format)
            return
          }
        }
      } catch {
        // A frame the decoder could not read. Keep scanning.
      }
    }
    if (!cameraOff) timer = setTimeout(() => void scanLoop(detector), SCAN_INTERVAL_MS)
  }

  async function start(): Promise<void> {
    if (destroyed) return
    if (!cameraSupported()) {
      fail(false)
      return
    }
    void loadBarcodeMap().catch(() => undefined)
    // Camera and decoder start in parallel. The stream is held (and shown) the moment it arrives,
    // so a stop() while the decoder is still loading reaches it; a stream that arrives after a
    // stop() is stopped at once.
    const streamReady = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then((opened) => {
      if (cameraOff) {
        opened.getTracks().forEach((track) => track.stop())
        return null
      }
      stream = opened
      // The camera can end on its own (unplugged, revoked, taken by another app): go manual
      // instead of leaving a frozen preview with the decode loop running.
      opened.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (!cameraOff) fail(false)
      }))
      video.srcObject = opened
      void video.play().catch(() => undefined)
      return opened
    })
    // Denied or no camera: go manual now, without waiting for the decoder to load.
    streamReady.catch(() => fail(false))
    const [streamResult, detectorResult] = await Promise.allSettled([streamReady, createDetector()])
    if (destroyed || cameraOff) {
      stopCamera()
      return
    }
    const detector = detectorResult.status === 'fulfilled' ? detectorResult.value : null
    if (streamResult.status !== 'fulfilled' || !streamResult.value || !detector) {
      fail(false)
      return
    }
    void scanLoop(detector)
  }

  manualBtn.addEventListener('click', () => {
    stop()
    handlers.onManual(null)
  })
  document.addEventListener('visibilitychange', onVisibilityChange)
  // Start after returning, so handlers never fire before the caller holds the panel.
  queueMicrotask(() => void start())

  return { stop }
}
