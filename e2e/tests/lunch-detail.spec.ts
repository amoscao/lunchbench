import { test, expect } from '@playwright/test'

test.describe('Lunch Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/leaderboard')
    await page.waitForSelector('.leaderboard-table tbody .lunch-name-row', { timeout: 15000 })
  })

  test('clicking a leaderboard row navigates to /lunch/:id', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await expect(page).toHaveURL(/\/lunch\/\d+/)
  })

  test('detail page shows the lunch name', async ({ page }) => {
    const firstName = await page.locator('.leaderboard-table tbody .lunch-name-row span').first().textContent()
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.detail-name', { timeout: 15000 })
    const detailName = await page.locator('.detail-name').textContent()
    expect(detailName?.trim()).toContain(firstName?.trim() ?? '')
  })

  test('detail page renders metric tiles', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.metric-row', { timeout: 15000 })
    const tiles = page.locator('.metric-tile')
    expect(await tiles.count()).toBeGreaterThanOrEqual(5)
  })

  test('detail page metric labels include Lunch Score, Confidence, Win Rate', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.metric-row', { timeout: 15000 })
    const labels = await page.locator('.metric-label').allTextContents()
    const upper = labels.map((l) => l.toUpperCase())
    expect(upper.some((l) => l.includes('LUNCH SCORE'))).toBe(true)
    expect(upper.some((l) => l.includes('CONFIDENCE'))).toBe(true)
    expect(upper.some((l) => l.includes('WIN RATE'))).toBe(true)
  })

  test('detail page metric values are non-empty', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.metric-row', { timeout: 15000 })
    const values = await page.locator('.metric-value').allTextContents()
    values.forEach((v) => expect(v.trim().length).toBeGreaterThan(0))
  })

  test('detail page shows W/L/T chips', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.wlt-chips', { timeout: 15000 })
    await expect(page.locator('.wlt-chip-win')).toBeVisible()
    await expect(page.locator('.wlt-chip-tie')).toBeVisible()
    await expect(page.locator('.wlt-chip-loss')).toBeVisible()
  })

  test('detail page shows W/L/T bar', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.wlt-bar', { timeout: 15000 })
    await expect(page.locator('.wlt-bar')).toBeVisible()
  })

  test('back button returns to leaderboard', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await page.waitForSelector('.detail-back', { timeout: 15000 })
    await page.locator('.detail-back').click()
    await expect(page).toHaveURL('/leaderboard')
    await expect(page.locator('.leaderboard-table')).toBeVisible()
  })

  test('direct URL navigation to /lunch/:id works', async ({ page }) => {
    await page.locator('.leaderboard-table tbody tr').first().click()
    await expect(page).toHaveURL(/\/lunch\/\d+/)
    const url = page.url()
    await page.goto(url)
    await page.waitForSelector('.metric-row', { timeout: 15000 })
    await expect(page.locator('.metric-row')).toBeVisible()
  })

  test('unknown lunch id shows not found', async ({ page }) => {
    await page.goto('/lunch/999999')
    await page.waitForSelector('.state-title', { timeout: 15000 })
    await expect(page.locator('.state-title')).toHaveText('Not found')
  })
})
