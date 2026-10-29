import { test, expect, type Page } from '@playwright/test'
import { waitForMatchup } from './helpers'

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

async function arenaImagesDecoded(page: Page): Promise<boolean[]> {
  return page.locator('.vote-arena .lunch-card-image img').evaluateAll((imgs) =>
    imgs.map((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)
  )
}

test.describe('Arena image preload', () => {
  test('pair renders only after both images have loaded', async ({ page }) => {
    let served = 0
    await page.route('**/api/matchup**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET' || url.pathname !== '/api/matchup') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const body = await response.json()
      if (body.status === 'ok') {
        served++
        body.left.image_url = `/e2e-slow-image.png?m=${served}&side=left`
        body.right.image_url = `/e2e-slow-image.png?m=${served}&side=right`
      }
      await route.fulfill({ response, json: body })
    })
    await page.route('**/e2e-slow-image.png*', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    })

    await page.goto('/')
    await waitForMatchup(page)
    expect(await arenaImagesDecoded(page)).toEqual([true, true])

    const firstPair = await page.locator('.lunch-card-image img').first().getAttribute('src')
    await page.locator('.vote-buttons .btn').nth(3).click()
    await expect(page.locator('.lunch-card-image img').first()).not.toHaveAttribute('src', firstPair ?? '')
    expect(await arenaImagesDecoded(page)).toEqual([true, true])

    // The background prefetch may still be in a route handler; detach so teardown does not race it.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
