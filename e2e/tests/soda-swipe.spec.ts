import { test, expect, type Page } from '@playwright/test'
import { API_URL, getSodaRow, putSodaSwipe } from './helpers'

const TOP = '.soda-card[data-depth="0"]'
const NEXT = '.soda-card[data-depth="1"]'

async function topId(page: Page): Promise<number> {
  const card = page.locator(TOP)
  await expect(card).toBeVisible()
  return Number(await card.getAttribute('data-soda-id'))
}

async function sessionId(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('lb_session_id') ?? '')
}

async function feedIds(session: string): Promise<number[]> {
  const res = await fetch(`${API_URL}/api/soda/deck`, { headers: { 'X-Lunchbench-Session': session } })
  return (await res.json() as { sodas: { id: number }[] }).sodas.map((soda) => soda.id)
}

/** Waits until the given card is no longer the top card. */
async function expectDismissed(page: Page, id: number): Promise<void> {
  await expect(page.locator(TOP)).not.toHaveAttribute('data-soda-id', String(id))
}

type DragOptions = { dx: number; dy?: number; steps: number; stepMs: number; holdMs?: number; grabAt?: number }

/** Mouse drag on the top card with controlled timing, so release velocity is predictable. */
async function drag(page: Page, options: DragOptions): Promise<void> {
  const box = (await page.locator(TOP).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height * (options.grabAt ?? 0.3)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= options.steps; i++) {
    await page.mouse.move(x + (options.dx * i) / options.steps, y + ((options.dy ?? 0) * i) / options.steps)
    if (options.stepMs > 0) await page.waitForTimeout(options.stepMs)
  }
  if (options.holdMs) await page.waitForTimeout(options.holdMs)
  await page.mouse.up()
}

function countSwipes(page: Page): { requests: Array<{ soda_id: number; direction: string }> } {
  const log = { requests: [] as Array<{ soda_id: number; direction: string }> }
  page.on('request', (request) => {
    if (request.url().includes('/api/soda/swipes') && request.method() === 'PUT') {
      log.requests.push(JSON.parse(request.postData() ?? '{}'))
    }
  })
  return log
}

test.describe('SodaArena swipe feed', () => {
  test('opens as one continuous feed with no deck counter', async ({ page }) => {
    await page.goto('/')
    await page.click('.nav-link[data-path="/soda"]')
    await expect(page).toHaveURL('/soda')
    await expect(page.locator('.page-heading')).toHaveText('SodaArena')
    await expect(page.locator('.nav-link[data-path="/soda"]')).toHaveClass(/active/)
    await expect(page.locator(TOP)).toHaveCount(1)
    await expect(page.locator(`${TOP} .soda-card-brand`)).not.toBeEmpty()
    await expect(page.locator(`${TOP} .soda-card-flavor`)).not.toBeEmpty()
    await expect(page.locator('body')).not.toContainText(/\d+ \/ \d+/)
    await expect(page.locator('.soda-progress')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start over' })).toHaveCount(0)
  })

  test('the next card is rendered underneath with its image loaded before the top card leaves', async ({ page }) => {
    await page.goto('/soda')
    const first = await topId(page)
    const next = page.locator(NEXT)
    await expect(next).toHaveCount(1)
    const nextId = Number(await next.getAttribute('data-soda-id'))
    await expect.poll(() => next.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // Mark the next card's element so we can prove it is promoted in place, not re-rendered.
    await next.evaluate((el) => { el.dataset.marker = 'promoted' })

    await page.getByRole('button', { name: 'Swipe right' }).click()
    await expectDismissed(page, first)
    const promoted = page.locator(TOP)
    await expect(promoted).toHaveAttribute('data-soda-id', String(nextId))
    await expect(promoted).toHaveAttribute('data-marker', 'promoted')
    expect(await promoted.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    // A fresh card was added at the bottom of the stack.
    await expect(page.locator('.soda-card[data-depth="2"]')).toHaveCount(1)
  })

  test('dragging right past the threshold records a like', async ({ page }) => {
    await page.goto('/soda')
    const id = await topId(page)
    const before = await getSodaRow(id)
    await drag(page, { dx: 260, dy: 20, steps: 12, stepMs: 16 })
    await expectDismissed(page, id)
    await expect.poll(async () => (await getSodaRow(id)).right_swipes).toBe(before.right_swipes + 1)
  })

  test('dragging left past the threshold records a not-like', async ({ page }) => {
    await page.goto('/soda')
    const id = await topId(page)
    const before = await getSodaRow(id)
    await drag(page, { dx: -260, dy: -10, steps: 12, stepMs: 16, grabAt: 0.7 })
    await expectDismissed(page, id)
    await expect.poll(async () => (await getSodaRow(id)).left_swipes).toBe(before.left_swipes + 1)
  })

  test('a slow drag below the threshold snaps back and records nothing', async ({ page }) => {
    await page.goto('/soda')
    const log = countSwipes(page)
    const id = await topId(page)
    await drag(page, { dx: 70, steps: 14, stepMs: 30, holdMs: 200 })
    await page.waitForTimeout(800)
    expect(await topId(page)).toBe(id)
    await expect(page.locator(TOP)).not.toHaveAttribute('style', /translate3d/)
    expect(log.requests).toHaveLength(0)
  })

  test('a fast short flick commits', async ({ page }) => {
    await page.goto('/soda')
    const log = countSwipes(page)
    const id = await topId(page)
    await drag(page, { dx: 60, steps: 3, stepMs: 0 })
    await expectDismissed(page, id)
    await expect.poll(() => log.requests).toEqual([{ soda_id: id, direction: 'right' }])
  })

  test('buttons and arrow keys swipe', async ({ page }) => {
    await page.goto('/soda')
    const log = countSwipes(page)
    const first = await topId(page)
    await page.getByRole('button', { name: 'Swipe left' }).click()
    await expectDismissed(page, first)
    const second = await topId(page)
    await page.keyboard.press('ArrowRight')
    await expectDismissed(page, second)
    await expect.poll(() => log.requests).toEqual([
      { soda_id: first, direction: 'left' },
      { soda_id: second, direction: 'right' },
    ])
  })

  test('rapid consecutive swipes each record the next drink in feed order', async ({ page }) => {
    await page.goto('/soda')
    await topId(page)
    const order = await feedIds(await sessionId(page))
    const log = countSwipes(page)
    for (let i = 0; i < 5; i++) await page.keyboard.press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft')

    await expect.poll(() => log.requests.length).toBe(5)
    expect(log.requests.map((r) => r.soda_id)).toEqual(order.slice(0, 5))
    expect(log.requests.map((r) => r.direction)).toEqual(['right', 'left', 'right', 'left', 'right'])
    expect(await topId(page)).toBe(order[5])
  })

  test('the feed ends with "You\'ve rated everything" and never repeats a drink', async ({ page }) => {
    await page.goto('/soda')
    await topId(page)
    const order = await feedIds(await sessionId(page))
    const log = countSwipes(page)
    for (let i = 0; i < order.length; i++) {
      await expect(page.locator(TOP)).toHaveAttribute('data-soda-id', String(order[i]))
      await page.keyboard.press('ArrowLeft')
    }

    await expect(page.locator('.soda-end-title')).toHaveText("You've rated everything")
    await expect(page.locator('.soda-end')).toHaveAttribute('role', 'status')
    await expect(page.locator('.soda-end-title')).toBeFocused()
    await expect(page.locator('.soda-announce')).toHaveText("You've rated everything")
    await expect(page.locator(TOP)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Swipe right' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Report a soda' })).toBeEnabled()
    await expect.poll(() => log.requests.length).toBe(order.length)
    expect(new Set(log.requests.map((r) => r.soda_id)).size).toBe(order.length)

    await expect.poll(async () => (await feedIds(await sessionId(page))).length).toBe(0)
    await page.reload()
    await expect(page.locator('.soda-end-title')).toHaveText("You've rated everything")
  })

  test('flung cards hop about one card width in the swipe direction and fade out', async ({ page }) => {
    type Exit = { shift: number; width: number; opacity: number }
    await page.addInitScript(() => {
      const w = window as unknown as { exits: Exit[]; rests: WeakMap<Element, number> }
      w.exits = []
      const remove = Element.prototype.remove
      Element.prototype.remove = function (this: Element) {
        if (this.classList.contains('leaving')) {
          const el = this as HTMLElement
          const r = el.getBoundingClientRect()
          // The stage centers the card at rest; rotation does not move the box center.
          const stage = el.parentElement!.getBoundingClientRect()
          w.exits.push({
            shift: r.left + r.width / 2 - (stage.left + stage.width / 2),
            width: el.offsetWidth,
            opacity: Number(getComputedStyle(el).opacity),
          })
        }
        return remove.call(this)
      }
    })
    await page.goto('/soda')
    const exits = () => page.evaluate(() => (window as unknown as { exits: Exit[] }).exits)

    let id = await topId(page)
    await drag(page, { dx: -250, steps: 12, stepMs: 16, grabAt: 0.3 })
    await expectDismissed(page, id)
    await expect.poll(async () => (await exits()).length).toBe(1)
    id = await topId(page)
    await drag(page, { dx: 250, steps: 12, stepMs: 16, grabAt: 0.7 })
    await expectDismissed(page, id)
    await expect.poll(async () => (await exits()).length).toBe(2)
    id = await topId(page)
    await page.keyboard.press('ArrowLeft')
    await expectDismissed(page, id)
    await expect.poll(async () => (await exits()).length).toBe(3)

    const [left, right, button] = await exits()
    for (const exit of [left, right, button]) {
      expect(exit.opacity).toBe(0)
      expect(Math.abs(exit.shift)).toBeGreaterThanOrEqual(exit.width * 0.9)
      expect(Math.abs(exit.shift)).toBeLessThanOrEqual(exit.width * 1.2)
    }
    expect(left.shift).toBeLessThan(0)
    expect(right.shift).toBeGreaterThan(0)
    expect(button.shift).toBeLessThan(0)
  })

  test('holding an arrow key records exactly one swipe', async ({ page }) => {
    await page.goto('/soda')
    const log = countSwipes(page)
    const id = await topId(page)
    // Repeated keydowns without keyup arrive with event.repeat = true, like OS auto-repeat.
    for (let i = 0; i < 20; i++) await page.keyboard.down('ArrowRight')
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(600)
    expect(log.requests).toEqual([{ soda_id: id, direction: 'right' }])
  })

  test('announces the new top drink to screen readers, and cards are named', async ({ page }) => {
    await page.goto('/soda')
    const top = page.locator(TOP)
    await expect(top).toBeVisible()
    const name = await top.getAttribute('aria-label')
    expect(name).toMatch(/\S+ \S+/)
    const announcer = page.locator('.soda-announce')
    await expect(announcer).toHaveAttribute('aria-live', 'polite')
    await expect(announcer).toHaveText(name!)

    const next = await page.locator(NEXT).getAttribute('aria-label')
    await page.keyboard.press('ArrowRight')
    await expect(announcer).toHaveText(next!)
  })

  test('an empty catalog says "No drinks yet"', async ({ page }) => {
    await page.route('**/api/soda/deck', (route) => route.fulfill({ json: { sodas: [] } }))
    await page.route('**/api/soda/catalog', (route) => route.fulfill({ json: { sodas: [] } }))
    await page.goto('/soda')
    await expect(page.locator('.soda-end-title')).toHaveText('No drinks yet')
    await expect(page.getByRole('button', { name: 'Swipe right' })).toBeDisabled()
  })

  test('the feed API returns only drinks this voter has not swiped', async () => {
    const session = crypto.randomUUID()
    const fresh = await feedIds(session)
    const swiped = fresh.slice(0, 3)
    for (const id of swiped) await putSodaSwipe(session, id, 'left')

    const next = await feedIds(session)
    expect(next).toHaveLength(fresh.length - 3)
    expect(next.some((id) => swiped.includes(id))).toBe(false)
  })

  test('arrow keys stop swiping after leaving the page', async ({ page }) => {
    const log = countSwipes(page)
    await page.goto('/soda')
    await topId(page)
    await page.click('.nav-link[data-path="/leaderboard"]')
    await expect(page).toHaveURL('/leaderboard')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(500)
    expect(log.requests).toHaveLength(0)
  })

  test('a swipe that fails twice shows an error instead of dropping silently', async ({ page }) => {
    let attempts = 0
    await page.route('**/api/soda/swipes', async (route) => {
      attempts += 1
      await route.fulfill({ status: 500, json: { error: 'boom', code: 'SERVER_ERROR' } })
    })
    await page.goto('/soda')
    await topId(page)
    await expect(page.locator('.soda-alert')).toBeHidden()
    await page.getByRole('button', { name: 'Swipe right' }).click()

    await expect(page.locator('.soda-alert')).toBeVisible()
    await expect(page.locator('.soda-alert')).toHaveText('Swipe not saved')
    expect(attempts).toBe(2)

    await page.unroute('**/api/soda/swipes')
    await page.getByRole('button', { name: 'Swipe left' }).click()
    await expect(page.locator('.soda-alert')).toBeHidden()
  })

  test('with reduced motion the card fades out and the next one is ready', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/soda')
    const id = await topId(page)
    await page.keyboard.press('ArrowRight')
    await expectDismissed(page, id)
    await expect(page.locator(`.soda-card[data-soda-id="${id}"]`)).toHaveCount(0, { timeout: 1000 })
  })
})

test.describe('SodaArena swipe feed on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  async function touchDrag(page: Page, dx: number, dy: number): Promise<void> {
    const box = (await page.locator(TOP).boundingBox())!
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height * 0.3)
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 12; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(x + (dx * i) / 12), y: Math.round(y + (dy * i) / 12) }],
      })
      await page.waitForTimeout(16)
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  test('a horizontal touch swipe records a like', async ({ page }) => {
    await page.goto('/soda')
    const id = await topId(page)
    const before = await getSodaRow(id)
    await touchDrag(page, 220, 10)
    await expectDismissed(page, id)
    await expect.poll(async () => (await getSodaRow(id)).right_swipes).toBe(before.right_swipes + 1)
  })

  test('a mostly vertical touch drag scrolls the page instead of swiping', async ({ page }) => {
    await page.goto('/soda')
    const log = countSwipes(page)
    const id = await topId(page)
    // Make the page taller than the phone screen so a vertical drag has somewhere to scroll.
    await page.evaluate(() => { document.body.style.minHeight = '3000px' })
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    await touchDrag(page, 12, -260)
    await page.waitForTimeout(800)

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    expect(await topId(page)).toBe(id)
    expect(log.requests).toHaveLength(0)
    await expect(page.locator(TOP)).not.toHaveAttribute('style', /translate3d/)
  })
})
