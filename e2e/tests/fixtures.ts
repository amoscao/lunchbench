import { test as base } from '@playwright/test'

export { expect, type Page } from '@playwright/test'

type Options = {
  /** Mark the first-visit SodaArena explainer as seen, so it does not cover the swipe feed. Default true. */
  sodaExplainerSeen: boolean
}

export const test = base.extend<Options>({
  sodaExplainerSeen: [true, { option: true }],
  context: async ({ context, sodaExplainerSeen }, use) => {
    if (sodaExplainerSeen) {
      // Key matches SODA_EXPLAINER_KEY in frontend/src/components/soda-explainer.ts.
      await context.addInitScript(() => {
        try {
          localStorage.setItem('lb_soda_explainer_seen', '1')
        } catch {
          // about:blank and other opaque origins have no storage.
        }
      })
    }
    await use(context)
  },
  // Route handlers that call route.fetch() can still be in flight (e.g. the
  // next-matchup prefetch) when a test ends. Unroute before the context closes
  // so those handlers do not fail the test with "Response has been disposed".
  page: async ({ page }, use) => {
    await use(page)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  },
})
