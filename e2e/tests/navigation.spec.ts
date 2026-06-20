import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('nav bar is present on all pages', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.nav')).toBeVisible()
    await expect(page.locator('.nav-logo')).toHaveText('🥪 LunchBench')

    await page.goto('/leaderboard')
    await expect(page.locator('.nav')).toBeVisible()

    await page.goto('/add')
    await expect(page.locator('.nav')).toBeVisible()
  })

  test('nav links navigate to correct pages', async ({ page }) => {
    await page.goto('/')

    await page.click('.nav-link[data-path="/leaderboard"]')
    await expect(page).toHaveURL('/leaderboard')
    await expect(page.locator('.page-heading')).toHaveText('Leaderboard')

    await page.click('.nav-link[data-path="/add"]')
    await expect(page).toHaveURL('/add')
    await expect(page.locator('.page-heading')).toHaveText('Add Lunch')

    await page.click('.nav-link[data-path="/"]')
    await expect(page).toHaveURL('/')
  })

  test('logo click navigates home', async ({ page }) => {
    await page.goto('/leaderboard')
    await page.click('.nav-logo')
    await expect(page).toHaveURL('/')
  })

  test('active nav link is highlighted', async ({ page }) => {
    await page.goto('/leaderboard')
    const leaderboardLink = page.locator('.nav-link[data-path="/leaderboard"]')
    await expect(leaderboardLink).toHaveClass(/active/)

    const homeLink = page.locator('.nav-link[data-path="/"]')
    await expect(homeLink).not.toHaveClass(/active/)
  })

  test('direct URL navigation works (SPA routing)', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.locator('.page-heading')).toHaveText('Leaderboard')

    await page.goto('/add')
    await expect(page.locator('.page-heading')).toHaveText('Add Lunch')
  })
})
