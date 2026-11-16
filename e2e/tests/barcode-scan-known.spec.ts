// Runs in the `camera-known` project: the fake camera shows the UPC-A of a Coca-Cola 12 oz can.
import { test, expect } from '@playwright/test'
import { KNOWN_GTIN } from '../fixtures/barcode-video'
import { ADMIN_MANAGER_PASSWORD, API_URL, getSodaRow, verifyPassword } from './helpers'
import { expectCameraOff, openReport, recordRequests, trackCameraStreams } from './camera-helpers'

async function sodaIdByName(name: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/catalog`)
  const { sodas } = await res.json() as { sodas: { id: number; name: string }[] }
  const soda = sodas.find((s) => s.name === name)
  if (!soda) throw new Error(`No soda named ${name}`)
  return soda.id
}

test.describe('Barcode scan mode: known code', () => {
  let cokeId = 0

  test.beforeAll(async () => {
    // The seed may already map this code; an admin mapping makes the test independent of seed data.
    cokeId = await sodaIdByName('Coca-Cola Original')
    const token = await verifyPassword(ADMIN_MANAGER_PASSWORD)
    const res = await fetch(`${API_URL}/api/admin/soda/barcodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: KNOWN_GTIN, soda_id: cokeId }),
    })
    expect(res.status).toBe(200)
  })

  test('scan, match, report; camera off; no image data leaves the device', async ({ page }) => {
    await trackCameraStreams(page)
    const network = recordRequests(page)
    const before = await getSodaRow(cokeId)

    await page.goto('/soda')
    const dialog = await openReport(page)

    await expect(dialog.locator('.barcode-scan-name')).toHaveText('Coca-Cola Original')
    await expectCameraOff(page)
    await expect(dialog.getByRole('button', { name: 'Select manually' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Like' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await getSodaRow(cokeId)).likes).toBe(before.likes + 1)

    const posts = network.requests.filter((request) => request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
    expect(posts.map((request) => new URL(request.url()).pathname)).toEqual(['/api/soda/reports'])
    expect(posts[0].postDataJSON()).toEqual({ soda_id: cokeId, verdict: 'like' })
    network.assertNoImageData()
  })
})
