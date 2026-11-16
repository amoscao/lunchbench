import { test, expect, type Page } from '@playwright/test'
import {
  ADMIN_MANAGER_PASSWORD,
  ADMIN_TOKEN,
  API_URL,
  PURCHASER_PASSWORD,
  verifyPassword,
} from './helpers'

type OrderItem = { slot: string; soda_id: number; type: string }

async function login(page: Page, password: string): Promise<void> {
  await page.fill('#chris-password', password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

async function getOrder(token: string): Promise<{ week_start: string; items: OrderItem[] }> {
  const res = await fetch(`${API_URL}/api/soda/order/latest`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.status).toBe(200)
  return res.json() as Promise<{ week_start: string; items: OrderItem[] }>
}

test.describe('Purchaser page /chris', () => {
  test('is not in the nav and asks for a password', async ({ page }) => {
    await page.goto('/chris')
    await expect(page.locator('.nav-link[data-path="/chris"]')).toHaveCount(0)
    await expect(page.locator('.page-heading')).toHaveText('Purchaser Login')
    await expect(page.locator('.order-table')).toHaveCount(0)
  })

  test('rejects a wrong password and a lunch password', async ({ page }) => {
    await page.goto('/chris')
    await login(page, 'not-the-purchaser-password')
    await expect(page.locator('.chris-login-error')).toBeVisible()
    await expect(page.locator('.order-table')).toHaveCount(0)

    await login(page, ADMIN_TOKEN)
    await expect(page.locator('.chris-login-error')).toHaveText('Not authorized')
    await expect(page.locator('.order-table')).toHaveCount(0)
  })

  test('shows this week\'s order list in slot order and stays logged in', async ({ page }) => {
    await page.goto('/chris')
    await login(page, PURCHASER_PASSWORD)

    await expect(page.locator('.page-heading')).toHaveText("This Week's Order")
    await expect(page.locator('.chris-week')).toHaveText(/^Week of [A-Z][a-z]{2} \d{1,2}$/)
    await expect(page.getByRole('button', { name: 'Export lunch PDF' })).toBeVisible()

    const rows = page.locator('.order-table tbody tr')
    await expect(rows).toHaveCount(13)
    const tags = await rows.locator('.soda-tag').allTextContents()
    expect(tags).toEqual([
      'Soda', 'Soda', 'Soda',
      'Seltzer', 'Seltzer', 'Seltzer',
      'Trial', 'Trial', 'Trial',
      'Backup', 'Backup', 'Backup', 'Backup',
    ])
    expect(await rows.locator('.order-rank').allTextContents())
      .toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)))
    for (let i = 0; i < 13; i++) {
      const row = rows.nth(i)
      const counts = await row.locator('.swipe-counts').count()
      const fresh = await row.locator('.soda-new').count()
      expect(counts + fresh).toBe(1)
      if (fresh) await expect(row.locator('.soda-new')).toHaveText(/^New (soda|seltzer) to try$/)
    }
    await expect(page.locator('.order-row-backup')).toHaveCount(4)

    await page.reload()
    await expect(page.locator('.order-table tbody tr')).toHaveCount(13)

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.locator('.page-heading')).toHaveText('Purchaser Login')
    await page.reload()
    await expect(page.locator('.page-heading')).toHaveText('Purchaser Login')
  })

  test('exports the lunch leaderboard PDF', async ({ page }) => {
    await page.goto('/chris')
    await login(page, PURCHASER_PASSWORD)
    await expect(page.locator('.order-table')).toBeVisible()

    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Export lunch PDF' }).click()
    const popup = await popupPromise
    await expect(popup).toHaveTitle('LunchBench Leaderboard')
    await expect(popup.locator('table tbody tr').first()).toBeVisible()
    await popup.close()
  })

  test('purchaser sessions read the order list but get no admin or lunch powers', async () => {
    const token = await verifyPassword(PURCHASER_PASSWORD)
    const auth = { Authorization: `Bearer ${token}` }

    const order = await getOrder(token)
    expect(order.items.map((item) => item.slot)).toEqual([
      'top', 'top', 'top', 'top', 'top', 'top', 'trial', 'trial', 'trial', 'backup', 'backup', 'backup', 'backup',
    ])
    const trialIds = order.items.filter((item) => item.slot === 'trial').map((item) => item.soda_id)
    const favoriteIds = order.items.filter((item) => item.slot !== 'trial').map((item) => item.soda_id)
    expect(trialIds.some((id) => favoriteIds.includes(id))).toBe(false)

    expect((await fetch(`${API_URL}/api/admin/lunches`, { headers: auth })).status).toBe(401)
    expect((await fetch(`${API_URL}/api/admin/soda/regenerate`, { method: 'POST', headers: auth })).status).toBe(401)
    expect((await fetch(`${API_URL}/api/lunches`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Purchaser lunch' }),
    })).status).toBe(401)

    const lunchToken = await verifyPassword(ADMIN_TOKEN)
    expect((await fetch(`${API_URL}/api/soda/order/latest`, {
      headers: { Authorization: `Bearer ${lunchToken}` },
    })).status).toBe(401)
  })

  test('admin regenerate is reproducible for the same week and data', async () => {
    const admin = await verifyPassword(ADMIN_MANAGER_PASSWORD)
    const regenerate = () => fetch(`${API_URL}/api/admin/soda/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
    })

    const first = await regenerate()
    expect(first.status).toBe(200)
    const { week_start } = await first.json() as { week_start: string }
    const a = await getOrder(admin)
    expect((await regenerate()).status).toBe(200)
    const b = await getOrder(admin)

    expect(a.week_start).toBe(week_start)
    expect(b.items.map((item) => item.soda_id)).toEqual(a.items.map((item) => item.soda_id))
  })
})
