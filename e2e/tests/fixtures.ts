import { test as base } from '@playwright/test'

export { expect, type Page } from '@playwright/test'

// Route handlers that call route.fetch() can still be in flight (e.g. the
// next-matchup prefetch) when a test ends. Unroute before the context closes
// so those handlers do not fail the test with "Response has been disposed".
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  },
})
