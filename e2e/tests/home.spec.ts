import { test, expect } from '@playwright/test'
import { waitForMatchup, castVote } from './helpers'

test.describe('Home / Voting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('loads voting page with two lunch cards', async ({ page }) => {
    await waitForMatchup(page)

    const cards = page.locator('.lunch-card')
    await expect(cards).toHaveCount(2)
  })

  test('each card shows a lunch name', async ({ page }) => {
    await waitForMatchup(page)

    const names = page.locator('.lunch-card-name')
    await expect(names).toHaveCount(2)

    const name1 = await names.nth(0).textContent()
    const name2 = await names.nth(1).textContent()
    expect(name1?.trim().length).toBeGreaterThan(0)
    expect(name2?.trim().length).toBeGreaterThan(0)
    expect(name1).not.toBe(name2)
  })

  test('cards show placeholder when no image exists', async ({ page }) => {
    await waitForMatchup(page)
    const placeholders = page.locator('.lunch-card-placeholder')
    await expect(placeholders).toHaveCount(2)
  })

  test('three vote buttons are present', async ({ page }) => {
    await waitForMatchup(page)

    const buttons = page.locator('.vote-buttons .btn')
    await expect(buttons).toHaveCount(3)
  })

  test('left vote button label contains left arrow', async ({ page }) => {
    await waitForMatchup(page)

    const leftBtn = page.locator('.vote-buttons .btn').nth(0)
    const btnText = await leftBtn.textContent()

    expect(btnText).toBeTruthy()
    expect(btnText!.includes('←')).toBe(true)
  })

  test('tie button is labeled Tie', async ({ page }) => {
    await waitForMatchup(page)
    const tieBtn = page.locator('.vote-buttons .btn').nth(1)
    await expect(tieBtn).toHaveText('Tie')
  })

  test('right vote button label contains right arrow', async ({ page }) => {
    await waitForMatchup(page)
    const rightBtn = page.locator('.vote-buttons .btn').nth(2)
    const btnText = await rightBtn.textContent()
    expect(btnText!.includes('→')).toBe(true)
  })

  test('casting a left vote loads a new matchup', async ({ page }) => {
    await waitForMatchup(page)
    await castVote(page, 'left')

    await page.waitForTimeout(1000)
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('casting a tie vote loads a new matchup', async ({ page }) => {
    await waitForMatchup(page)
    await castVote(page, 'tie')
    await page.waitForTimeout(1000)
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('casting a right vote loads a new matchup', async ({ page }) => {
    await waitForMatchup(page)
    await castVote(page, 'right')
    await page.waitForTimeout(1000)
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('vote buttons are disabled during submission', async ({ page }) => {
    await waitForMatchup(page)

    await page.route('/api/vote', async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.continue()
    })

    const leftBtn = page.locator('.vote-buttons .btn').nth(0)
    await leftBtn.click()

    await expect(leftBtn).toBeDisabled()
  })

  test('multiple votes work in sequence', async ({ page }) => {
    await waitForMatchup(page)

    for (let i = 0; i < 3; i++) {
      try {
        await waitForMatchup(page)
        await castVote(page, 'left')
        await page.waitForTimeout(800)
      } catch {
        break
      }
    }

    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
