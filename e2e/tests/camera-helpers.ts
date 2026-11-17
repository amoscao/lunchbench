import { expect, type Page, type Request } from '@playwright/test'

declare global {
  interface Window {
    __lbStreams: MediaStream[]
    __lbConstraints: MediaStreamConstraints[]
  }
}

/** Records every camera stream the page opens, so tests can check that all tracks end. Not a stub. */
export async function trackCameraStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__lbStreams = []
    window.__lbConstraints = []
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) return
    const original = media.getUserMedia.bind(media)
    media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      window.__lbConstraints.push(constraints ?? {})
      const stream = await original(constraints)
      window.__lbStreams.push(stream)
      return stream
    }
  })
}

export async function liveTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window.__lbStreams ?? []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length)
}

export async function openedTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window.__lbStreams ?? []).flatMap((s) => s.getTracks()).length)
}

export async function expectCameraOff(page: Page): Promise<void> {
  await expect.poll(() => openedTracks(page)).toBeGreaterThan(0)
  await expect.poll(() => liveTracks(page)).toBe(0)
}

export async function openReport(page: Page) {
  await page.getByRole('button', { name: 'Report a soda' }).click()
  // The title follows the mode ("Scan the soda barcode" while scanning, "Report a soda" otherwise),
  // so find the dialog by role alone: it is the only one.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Collects every request the page sends. `assertNoImageData` then checks that nothing carried image
 * or frame data: every request body is small JSON of scalars sent to our own origin, and no URL is long.
 */
export function recordRequests(page: Page): { requests: Request[]; assertNoImageData: () => void } {
  const requests: Request[] = []
  page.on('request', (request) => requests.push(request))
  return {
    requests,
    assertNoImageData() {
      const origin = new URL(page.url()).origin
      const allowedKeys = new Set(['soda_id', 'verdict', 'barcode', 'format', 'direction'])
      for (const request of requests) {
        const url = request.url()
        // data:/blob: URLs never leave the browser (e.g. the inline favicon).
        if (url.startsWith('data:') || url.startsWith('blob:')) continue
        expect(url.length, 'no data smuggled in a URL').toBeLessThan(2048)
        const body = request.postDataBuffer()
        if (!body) continue
        expect(new URL(url).origin, url).toBe(origin)
        const type = request.headers()['content-type'] ?? ''
        expect(type, request.url()).toContain('application/json')
        expect(body.length, request.url()).toBeLessThan(512)
        const text = body.toString('utf8')
        expect(text).not.toMatch(/data:|base64|image\//i)
        const parsed = JSON.parse(text) as Record<string, unknown>
        for (const [key, value] of Object.entries(parsed)) {
          expect(allowedKeys.has(key), `${request.url()} sent ${key}`).toBe(true)
          expect(typeof value === 'string' || typeof value === 'number', `${key} is a scalar`).toBe(true)
        }
      }
    },
  }
}
