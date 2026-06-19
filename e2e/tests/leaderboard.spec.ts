import { test, expect } from '@playwright/test'

test.describe('Leaderboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/leaderboard')
    await page.waitForTimeout(1500)
  })

  test('leaderboard page loads and shows heading', async ({ page }) => {
    await expect(page.locator('.page-heading')).toHaveText('Leaderboard')
  })

  test('shows all seeded lunches', async ({ page }) => {
    const rows = page.locator('.leaderboard-table tbody tr')
    expect(await rows.count()).toBeGreaterThanOrEqual(5)
  })

  test('rank badges are visible', async ({ page }) => {
    const rows = page.locator('.leaderboard-table tbody tr')
    const badges = page.locator('.rank-badge')
    expect(await badges.count()).toBe(await rows.count())
    expect(await badges.count()).toBeGreaterThanOrEqual(5)
  })

  test('first rank badge has gold class', async ({ page }) => {
    const firstBadge = page.locator('.rank-badge').first()
    await expect(firstBadge).toHaveClass(/gold/)
    await expect(firstBadge).toHaveText('1')
  })

  test('second rank badge has silver class', async ({ page }) => {
    const secondBadge = page.locator('.rank-badge').nth(1)
    await expect(secondBadge).toHaveClass(/silver/)
  })

  test('third rank badge has bronze class', async ({ page }) => {
    const thirdBadge = page.locator('.rank-badge').nth(2)
    await expect(thirdBadge).toHaveClass(/bronze/)
  })

  test('lunch names are displayed', async ({ page }) => {
    const nameTexts = await page.locator('.name-cell span').allTextContents()
    expect(nameTexts.length).toBeGreaterThanOrEqual(5)
    nameTexts.forEach((name) => expect(name.trim().length).toBeGreaterThan(0))
  })

  test('ratings are displayed as integers', async ({ page }) => {
    const ratings = await page.locator('td.col-rating').allTextContents()
    ratings.forEach((r) => {
      const num = parseInt(r.trim(), 10)
      expect(Number.isNaN(num)).toBe(false)
      expect(num).toBeGreaterThan(0)
    })
  })

  test('Elo ratings update after voting', async ({ page }) => {
    const initialRatings = await page.locator('td.col-rating').allTextContents()

    await page.goto('/')
    await page.waitForSelector('.vote-arena', { timeout: 15000 })
    await page.locator('.vote-buttons .btn').nth(0).click()
    await page.waitForTimeout(1000)

    await page.goto('/leaderboard')
    await page.waitForTimeout(1500)

    const updatedRatings = await page.locator('td.col-rating').allTextContents()

    const changed = initialRatings.some(
      (r, i) => r !== updatedRatings[i]
    )
    expect(changed).toBe(true)
  })

  test('placeholder thumbnails shown when no image', async ({ page }) => {
    const placeholders = page.locator('.lunch-thumb-placeholder')
    const thumbs = page.locator('.lunch-thumb')
    expect(await placeholders.count()).toBeGreaterThanOrEqual(5)
    await expect(thumbs).toHaveCount(0)
  })

  test('win/loss/tie record shown in record column', async ({ page }) => {
    const rows = page.locator('.leaderboard-table tbody tr')
    const recordCells = page.locator('td.col-record')
    expect(await recordCells.count()).toBe(await rows.count())
    expect(await recordCells.count()).toBeGreaterThanOrEqual(5)
  })
})
