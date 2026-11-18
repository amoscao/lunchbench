import { test, expect } from './fixtures'

const TOP = '.soda-card[data-depth="0"]'

test.describe('SodaArena explainer', () => {
  test.use({ sodaExplainerSeen: false })

  test('first visit shows the explainer once; dismissing it remembers', async ({ page }) => {
    await page.goto('/soda')
    const dialog = page.getByRole('dialog', { name: 'How SodaArena works' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('LIKE')
    await expect(dialog).toContainText('DISLIKE')
    const start = dialog.getByRole('button', { name: 'Start swiping' })
    await expect(start).toBeFocused()

    // Arrow keys belong to the dialog while it is open: no card leaves.
    await expect(page.locator(TOP)).toBeVisible()
    const id = await page.locator(TOP).getAttribute('data-soda-id')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator(TOP)).toHaveAttribute('data-soda-id', id!)

    await start.click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('lb_soda_explainer_seen'))).toBe('1')

    await page.reload()
    await expect(page.locator(TOP)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Escape closes it and the help button reopens it', async ({ page }) => {
    await page.goto('/soda')
    const dialog = page.getByRole('dialog', { name: 'How SodaArena works' })
    await expect(dialog).toBeVisible()
    // The swipe buttons enable once the feed loads.
    await expect(page.locator(TOP)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('lb_soda_explainer_seen'))).toBe('1')
    // First-visit close has no opener: focus lands on the page's swipe button, not <body>.
    await expect(page.getByRole('button', { name: 'Swipe right' })).toBeFocused()

    const help = page.getByRole('button', { name: 'How SodaArena works' })
    await help.click()
    await expect(dialog).toBeVisible()
    // Tab stays inside the dialog.
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Start swiping' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(help).toBeFocused()
  })
})
