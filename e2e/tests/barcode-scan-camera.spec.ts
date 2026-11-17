// Runs in the `camera-blank` project: a touch device whose fake camera shows a blank frame,
// so scanning keeps running until the test ends it.
import { test, expect } from './fixtures'
import { expectCameraOff, liveTracks, openReport, trackCameraStreams } from './camera-helpers'

test.describe('Barcode scan mode: camera lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await trackCameraStreams(page)
  })

  test('touch devices open the report in scan mode with the rear camera', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)

    await expect(dialog.getByRole('heading')).toHaveText('Scan the soda barcode')
    await expect(dialog).toHaveAccessibleName('Scan the soda barcode')
    await expect(dialog.getByLabel('Camera')).toBeVisible()
    // Square scan area, so a barcode fits held either way.
    const view = await dialog.locator('.barcode-scan-view').boundingBox()
    expect(Math.abs(view!.width - view!.height)).toBeLessThanOrEqual(1)
    await expect(dialog.getByRole('button', { name: 'Select manually' })).toBeVisible()
    await expect(dialog.getByRole('combobox')).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'I like' })).toBeDisabled()
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)
    const constraints = await page.evaluate(() => window.__lbConstraints[0])
    expect(constraints.video).toMatchObject({ facingMode: { ideal: 'environment' } })
    expect(constraints.audio).toBe(false)
  })

  test('closing the modal stops the camera', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await expectCameraOff(page)
  })

  test('Escape closes and stops the camera', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expectCameraOff(page)
  })

  test('Select manually stops the camera; Scan barcode starts it again', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    await dialog.getByRole('button', { name: 'Select manually' }).click()
    await expect(dialog.getByRole('combobox')).toBeFocused()
    // No scan result, so no "not found" notice.
    await expect(dialog.locator('.soda-report-notice')).toBeHidden()
    await expect(dialog.getByRole('heading')).toHaveText('Report a soda')
    await expect(dialog.getByLabel('Camera')).toHaveCount(0)
    await expectCameraOff(page)

    await dialog.getByRole('button', { name: 'Scan barcode' }).click()
    await expect(dialog.getByLabel('Camera')).toBeVisible()
    await expect.poll(() => liveTracks(page)).toBe(1)
  })

  test('a route change stops the camera', async ({ page }) => {
    await page.goto('/soda')
    await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    await page.evaluate(() => {
      history.pushState(null, '', '/leaderboard')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectCameraOff(page)
  })

  test('hiding the page stops the camera and falls back to manual', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expectCameraOff(page)
    await expect(dialog.getByRole('combobox')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Scan barcode' })).toBeVisible()
  })

  // Hold the WebAssembly decoder so the camera is live while startup is still pending.
  async function delayDecoder(page: import('@playwright/test').Page): Promise<() => boolean> {
    let held = false
    await page.route('**/*zxing_reader*.wasm*', async (route) => {
      held = true
      await new Promise((resolve) => setTimeout(resolve, 6000))
      await route.continue().catch(() => undefined)
    })
    return () => held
  }

  test('closing while the decoder is still loading stops the camera at once', async ({ page }) => {
    const held = await delayDecoder(page)
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)
    await expect.poll(held).toBe(true)

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => liveTracks(page), { timeout: 1000 }).toBe(0)
  })

  test('hiding the page while the decoder is still loading stops the camera at once', async ({ page }) => {
    const held = await delayDecoder(page)
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)
    await expect.poll(held).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => liveTracks(page), { timeout: 1000 }).toBe(0)
    await expect(dialog.getByRole('combobox')).toBeVisible()
  })

  test('a camera that ends on its own falls back to manual', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await expect.poll(() => liveTracks(page)).toBeGreaterThan(0)

    // track.stop() alone fires no event; a real device loss fires `ended` on the track.
    await page.evaluate(() => {
      for (const track of window.__lbStreams.flatMap((stream) => stream.getVideoTracks())) {
        track.stop()
        track.dispatchEvent(new Event('ended'))
      }
    })
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await expect(dialog.getByLabel('Camera')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Scan barcode' })).toBeHidden()
  })

  test('denied camera permission lands in manual search with no error', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await page.goto('/soda')
    const dialog = await openReport(page)

    await expect(dialog.getByRole('combobox')).toBeFocused()
    await expect(dialog.getByLabel('Camera')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Scan barcode' })).toBeHidden()
    await expect(page.locator('.alert:visible')).toHaveCount(0)
    await expect(dialog.locator('.soda-report-notice')).toBeHidden()

    await dialog.getByRole('combobox').fill('sprite')
    await dialog.locator('.soda-suggest-item', { hasText: 'Sprite Original' }).click()
    await expect(dialog.getByRole('button', { name: 'I like' })).toBeEnabled()
  })

  test('no camera API lands in manual search', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    })
    await page.goto('/soda')
    const dialog = await openReport(page)

    await expect(dialog.getByRole('combobox')).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Scan barcode' })).toBeHidden()
  })
})
