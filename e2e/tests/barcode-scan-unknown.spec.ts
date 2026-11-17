// Runs in the `camera-unknown` project: the fake camera shows a valid UPC-A that no drink has.
import { test, expect } from '@playwright/test'
import { UNKNOWN_GTIN } from '../fixtures/barcode-video'
import { API_URL } from './helpers'
import { expectCameraOff, openReport, recordRequests, trackCameraStreams } from './camera-helpers'

async function barcodes(): Promise<{ code: string; soda_id: number }[]> {
  const res = await fetch(`${API_URL}/api/soda/barcodes`)
  return (await res.json() as { barcodes: { code: string; soda_id: number }[] }).barcodes
}

test.describe('Barcode scan mode: unknown code', () => {
  test('unknown code is logged, picked manually, then mapped so the next scan matches', async ({ page }) => {
    expect((await barcodes()).some((row) => row.code === UNKNOWN_GTIN)).toBe(false)
    await trackCameraStreams(page)
    const network = recordRequests(page)

    await page.goto('/soda')
    let dialog = await openReport(page)

    // Unknown: manual search with a "not found" notice, camera off, code logged.
    const combobox = dialog.getByRole('combobox')
    await expect(combobox).toBeFocused()
    await expect(dialog.getByRole('status')).toHaveText('Barcode not found. Try searching for the drink instead.')
    await expect(dialog.getByRole('status')).toBeVisible()
    await expect(dialog.getByRole('heading')).toHaveText('Report a soda')
    await expectCameraOff(page)
    await expect.poll(() => network.requests.filter((r) => r.url().endsWith('/api/soda/unknown-scans')).length).toBe(1)
    const log = network.requests.find((r) => r.url().endsWith('/api/soda/unknown-scans'))!
    expect(log.postDataJSON()).toEqual({ barcode: UNKNOWN_GTIN, format: 'ean_13' })

    await combobox.fill('olipop vintage')
    await dialog.locator('.soda-suggest-item', { hasText: 'OLIPOP Vintage Cola' }).click()
    await dialog.getByRole('button', { name: 'I like' }).click()
    await expect(dialog).toBeHidden()

    const report = network.requests.find((r) => r.url().endsWith('/api/soda/reports'))!
    expect(report.postDataJSON()).toMatchObject({ verdict: 'like', barcode: UNKNOWN_GTIN })
    const olipopId = (report.postDataJSON() as { soda_id: number }).soda_id
    await expect.poll(async () => (await barcodes()).find((row) => row.code === UNKNOWN_GTIN)?.soda_id).toBe(olipopId)

    // Same page: the learned mapping is remembered locally, so a re-scan matches.
    dialog = await openReport(page)
    await expect(dialog.locator('.barcode-scan-name')).toHaveText('OLIPOP Vintage Cola')

    // After a reload the mapping comes from the server.
    await page.reload()
    dialog = await openReport(page)
    await expect(dialog.locator('.barcode-scan-name')).toHaveText('OLIPOP Vintage Cola')
    expect(network.requests.filter((r) => r.url().endsWith('/api/soda/unknown-scans'))).toHaveLength(1)
    network.assertNoImageData()
  })
})
