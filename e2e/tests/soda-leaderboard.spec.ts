import { test, expect } from '@playwright/test'
import { getSodaLeaderboard, putSodaSwipe } from './helpers'

test.describe('Soda leaderboard', () => {
  test('lunch leaderboard keeps its heading and gains Lunch / Soda tabs', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.locator('.page-heading')).toHaveText('Leaderboard')
    await expect(page.locator('.board-tab.active')).toHaveText('Lunch')

    await page.getByRole('tab', { name: 'Soda' }).click()
    await expect(page).toHaveURL('/leaderboard/soda')
    await expect(page.locator('.page-heading')).toHaveText('Soda Leaderboard')
    await expect(page.locator('.board-tab.active')).toHaveText('Soda')
    await expect(page.locator('.nav-link[data-path="/leaderboard"]')).toHaveClass(/active/)

    await page.getByRole('tab', { name: 'Lunch' }).click()
    await expect(page).toHaveURL('/leaderboard')
    await expect(page.locator('.page-heading')).toHaveText('Leaderboard')
  })

  test('ranks every drink with a type tag and swipe counts or a new-drink label', async ({ page }) => {
    const rows = await getSodaLeaderboard()
    await page.goto('/leaderboard/soda')
    const uiRows = page.locator('.soda-table tbody tr[data-soda-id]')
    await expect(uiRows).toHaveCount(rows.length)

    for (const row of rows) {
      const ui = page.locator(`.soda-table tbody tr[data-soda-id="${row.id}"]`)
      await expect(ui.locator('.rank-badge')).toHaveText(String(row.rank))
      await expect(ui.locator('.lunch-name-row')).toHaveText(row.name)
      await expect(ui.locator('.soda-tag')).toHaveText(row.type === 'seltzer' ? 'Seltzer' : 'Soda')
      if (row.has_data) {
        await expect(ui.locator('.swipe-count-right')).toHaveText(String(row.right_swipes))
        await expect(ui.locator('.swipe-count-left')).toHaveText(String(row.left_swipes))
      } else {
        await expect(ui.locator('.soda-new')).toHaveText(row.type === 'seltzer' ? 'New seltzer to try' : 'New soda to try')
      }
    }

    const thumb = uiRows.first().locator('img.soda-thumb')
    await expect(thumb).toBeVisible()
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  })

  test('right swipes raise a drink and show in its counts', async ({ page }) => {
    const target = (await getSodaLeaderboard()).filter((row) => !row.has_data).at(-1)
    if (!target) throw new Error('Seed needs a drink with no data')
    for (let i = 0; i < 3; i++) await putSodaSwipe(crypto.randomUUID(), target.id, 'right')

    await page.goto('/leaderboard/soda')
    const ui = page.locator(`.soda-table tbody tr[data-soda-id="${target.id}"]`)
    await expect(ui.locator('.swipe-count-right')).toHaveText(String(target.right_swipes + 3))

    const after = (await getSodaLeaderboard()).find((row) => row.id === target.id)!
    expect(after.rank).toBeLessThan(target.rank)
  })
})
