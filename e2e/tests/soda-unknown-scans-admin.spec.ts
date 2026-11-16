import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { ADMIN_MANAGER_PASSWORD, ADMIN_TOKEN, API_URL, PURCHASER_PASSWORD, verifyPassword } from './helpers'

// Valid check digits, not real products, distinct from the camera clips.
const MAP_ME = '0098765432105'
const PICKED = '0011111111110'
// Sprite Original 12 oz can, mapped by the seed migration.
const SEEDED = '0049000001327'

async function sodaIdByName(name: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/catalog`)
  const { sodas } = await res.json() as { sodas: { id: number; name: string }[] }
  const soda = sodas.find((s) => s.name === name)
  if (!soda) throw new Error(`No soda named ${name}`)
  return soda.id
}

async function logScan(session: string, barcode: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/soda/unknown-scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': session },
    body: JSON.stringify({ barcode, format: 'ean_13' }),
  })
  expect(res.status).toBe(200)
}

async function mappedTo(code: string): Promise<number | undefined> {
  const res = await fetch(`${API_URL}/api/soda/barcodes`)
  const { barcodes } = await res.json() as { barcodes: { code: string; soda_id: number }[] }
  return barcodes.find((row) => row.code === code)?.soda_id
}

test.describe('Admin unknown scans', () => {
  const sessions = [randomUUID(), randomUUID(), randomUUID()]

  test.beforeAll(async () => {
    await logScan(sessions[0], MAP_ME)
    await logScan(sessions[1], MAP_ME)
    await logScan(sessions[0], MAP_ME)
    // A voter scans PICKED, then reports Sprite manually with the code: picked-after and voter mapping.
    await logScan(sessions[2], PICKED)
    const res = await fetch(`${API_URL}/api/soda/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': sessions[2] },
      body: JSON.stringify({ soda_id: await sodaIdByName('Sprite Original'), verdict: 'like', barcode: PICKED }),
    })
    expect(res.status).toBe(200)
    await logScan(sessions[0], SEEDED)
  })

  test('only admin sessions can read or change the log', async () => {
    for (const password of [ADMIN_TOKEN, PURCHASER_PASSWORD]) {
      const auth = { Authorization: `Bearer ${await verifyPassword(password)}`, 'Content-Type': 'application/json' }
      expect((await fetch(`${API_URL}/api/admin/soda/unknown-scans`, { headers: auth })).status).toBe(401)
      expect((await fetch(`${API_URL}/api/admin/soda/barcodes`, { method: 'POST', headers: auth, body: JSON.stringify({ code: MAP_ME, soda_id: 1 }) })).status).toBe(401)
      expect((await fetch(`${API_URL}/api/admin/soda/unknown-scans/${MAP_ME}`, { method: 'DELETE', headers: auth })).status).toBe(401)
    }
  })

  test('admin sees grouped scans and maps a code to a drink', async ({ page }) => {
    const drPepper = await sodaIdByName('Dr Pepper Original')
    await page.goto('/admin')
    await page.locator('#admin-pw').fill(ADMIN_MANAGER_PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()
    await page.getByRole('button', { name: 'Unknown scans' }).click()

    const row = page.locator('tr', { hasText: MAP_ME })
    await expect(row).toBeVisible()
    const cells = row.locator('td')
    await expect(cells.nth(1)).toHaveText('3') // scans
    await expect(cells.nth(2)).toHaveText('2') // distinct voters
    await expect(cells.nth(6)).toHaveText('-') // not mapped

    const picked = page.locator('tr', { hasText: PICKED }).locator('td')
    await expect(picked.nth(5)).toHaveText('Sprite Original ×1')
    await expect(picked.nth(6)).toHaveText('Sprite Original (voter)')
    await expect(page.locator('tr', { hasText: SEEDED }).locator('td').nth(6)).toHaveText('Sprite Original (seed)')

    const text = await page.locator('#admin-tab-content').innerText()
    for (const session of sessions) expect(text).not.toContain(session)

    await row.getByRole('combobox').selectOption({ label: 'Dr Pepper Original' })
    await row.getByRole('button', { name: 'Map' }).click()
    await expect(page.locator('tr', { hasText: MAP_ME }).locator('td').nth(6)).toHaveText('Dr Pepper Original (admin)')
    expect(await mappedTo(MAP_ME)).toBe(drPepper)

    // Dismiss drops voter-learned mappings (the code is unknown again) and keeps admin and seed ones.
    const sprite = await sodaIdByName('Sprite Original')
    expect(await mappedTo(PICKED)).toBe(sprite)
    for (const code of [PICKED, MAP_ME, SEEDED]) {
      await page.locator('tr', { hasText: code }).getByRole('button', { name: 'Dismiss' }).click()
      await expect(page.locator('tr', { hasText: code })).toHaveCount(0)
    }
    expect(await mappedTo(PICKED)).toBeUndefined()
    expect(await mappedTo(MAP_ME)).toBe(drPepper)
    expect(await mappedTo(SEEDED)).toBe(sprite)
  })
})
