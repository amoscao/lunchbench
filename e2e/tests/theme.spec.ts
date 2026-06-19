import { test, expect } from '@playwright/test'

test.describe('Theme', () => {
  test('default theme is applied', async ({ page }) => {
    await page.goto('/')
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(['light', 'dark']).toContain(theme)
  })

  test('theme toggle switches between light and dark', async ({ page }) => {
    await page.goto('/')

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light')
      localStorage.setItem('theme', 'light')
    })

    const toggle = page.locator('.nav-theme-toggle')
    await expect(toggle).toBeVisible()

    await toggle.click()
    const darkTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(darkTheme).toBe('dark')

    await toggle.click()
    const lightTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(lightTheme).toBe('light')
  })

  test('theme persists after page reload', async ({ page }) => {
    await page.goto('/')

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
      localStorage.setItem('theme', 'dark')
    })

    await page.reload()

    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    )
    expect(theme).toBe('dark')
  })

  test('theme toggle icon updates on switch', async ({ page }) => {
    await page.goto('/')

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light')
      localStorage.setItem('theme', 'light')
      const t = document.querySelector('.nav-theme-toggle') as HTMLButtonElement
      if (t) t.textContent = '☾'
    })

    const toggle = page.locator('.nav-theme-toggle')
    await toggle.click()

    const iconText = await toggle.textContent()
    expect(iconText?.trim()).toBe('☀')
  })
})
