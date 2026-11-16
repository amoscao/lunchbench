import { test, expect, type Page } from '@playwright/test'
import { API_URL, getSodaRow, putSodaSwipe } from './helpers'

async function deckSize(): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/catalog`)
  const { sodas } = await res.json() as { sodas: unknown[] }
  return Math.min(20, sodas.length)
}

async function currentSodaId(page: Page): Promise<number> {
  const card = page.locator('.soda-card[data-soda-id]')
  await expect(card).toBeVisible()
  return Number(await card.getAttribute('data-soda-id'))
}

async function expectCard(page: Page, n: number, total: number): Promise<void> {
  await expect(page.locator('.soda-progress-label')).toHaveText(`${n} / ${total}`)
  await expect(page.locator('.soda-card[data-soda-id]')).toHaveCount(1)
}

test.describe('Sodabench swipe deck', () => {
  test('nav link opens the deck with one card and progress', async ({ page }) => {
    const total = await deckSize()
    await page.goto('/')
    await page.click('.nav-link[data-path="/soda"]')
    await expect(page).toHaveURL('/soda')
    await expect(page.locator('.page-heading')).toHaveText('SodaArena')
    await expect(page.locator('.nav-link[data-path="/soda"]')).toHaveClass(/active/)
    await expectCard(page, 1, total)
    await expect(page.locator('.soda-card .soda-card-brand')).not.toBeEmpty()
    await expect(page.locator('.soda-card .soda-card-flavor')).not.toBeEmpty()
    await expect(page.locator('.soda-card img')).toHaveJSProperty('complete', true)
    expect(await page.locator('.soda-card img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  })

  test('buttons, arrow keys and drag each record a swipe', async ({ page }) => {
    const total = await deckSize()
    await page.goto('/soda')
    await expectCard(page, 1, total)

    const first = await currentSodaId(page)
    const firstBefore = await getSodaRow(first)
    await page.getByRole('button', { name: 'Swipe right' }).click()
    await expectCard(page, 2, total)

    const second = await currentSodaId(page)
    const secondBefore = await getSodaRow(second)
    await page.keyboard.press('ArrowLeft')
    await expectCard(page, 3, total)

    const third = await currentSodaId(page)
    const thirdBefore = await getSodaRow(third)
    const box = (await page.locator('.soda-card[data-soda-id]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expectCard(page, 4, total)

    await expect.poll(async () => (await getSodaRow(first)).right_swipes).toBe(firstBefore.right_swipes + 1)
    await expect.poll(async () => (await getSodaRow(second)).left_swipes).toBe(secondBefore.left_swipes + 1)
    await expect.poll(async () => (await getSodaRow(third)).right_swipes).toBe(thirdBefore.right_swipes + 1)
  })

  test('a short drag snaps back without swiping', async ({ page }) => {
    const total = await deckSize()
    await page.goto('/soda')
    await expectCard(page, 1, total)
    const id = await currentSodaId(page)

    const box = (await page.locator('.soda-card[data-soda-id]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 3 })
    await page.mouse.up()

    await expectCard(page, 1, total)
    expect(await currentSodaId(page)).toBe(id)
  })

  test('finishing the deck shows Deck done, and Start over deals a new deck', async ({ page }) => {
    const total = await deckSize()
    await page.goto('/soda')
    for (let n = 1; n <= total; n++) {
      await expectCard(page, n, total)
      await page.keyboard.press('ArrowRight')
    }

    await expect(page.locator('.soda-done-title')).toHaveText('Deck done')
    await expect(page.locator('.soda-progress-label')).toHaveText(`${total} / ${total}`)
    await expect(page.getByRole('button', { name: 'Swipe right' })).toBeDisabled()

    await page.getByRole('button', { name: 'Start over' }).click()
    await expectCard(page, 1, total)
  })

  test('the deck serves unswiped drinks before repeating swiped ones', async () => {
    const session = crypto.randomUUID()
    const res = await fetch(`${API_URL}/api/soda/deck`, { headers: { 'X-Lunchbench-Session': session } })
    const fresh = (await res.json() as { sodas: { id: number }[] }).sodas.map((soda) => soda.id)
    const swiped = fresh.slice(0, 3)
    for (const id of swiped) await putSodaSwipe(session, id, 'left')

    const next = await fetch(`${API_URL}/api/soda/deck`, { headers: { 'X-Lunchbench-Session': session } })
    const ids = (await next.json() as { sodas: { id: number }[] }).sodas.map((soda) => soda.id)
    const firstRepeat = ids.findIndex((id) => swiped.includes(id))
    const lastFresh = ids.reduce((last, id, index) => (swiped.includes(id) ? last : index), -1)
    expect(firstRepeat === -1 || firstRepeat > lastFresh).toBe(true)
    if (fresh.length < 20) {
      // Small catalog: the whole pool fits, so repeats fill the end of the deck.
      expect(ids.slice(-swiped.length).sort()).toEqual([...swiped].sort())
    } else {
      expect(firstRepeat).toBe(-1)
    }
  })

  test('arrow keys stop swiping after leaving the page', async ({ page }) => {
    const total = await deckSize()
    let swipeRequests = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/soda/swipes')) swipeRequests += 1
    })

    await page.goto('/soda')
    await expectCard(page, 1, total)
    await page.click('.nav-link[data-path="/leaderboard"]')
    await expect(page).toHaveURL('/leaderboard')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(500)

    expect(swipeRequests).toBe(0)
  })

  test('a swipe that fails twice shows an error instead of dropping silently', async ({ page }) => {
    const total = await deckSize()
    let attempts = 0
    await page.route('**/api/soda/swipes', async (route) => {
      attempts += 1
      await route.fulfill({ status: 500, json: { error: 'boom', code: 'SERVER_ERROR' } })
    })

    await page.goto('/soda')
    await expectCard(page, 1, total)
    await expect(page.locator('.soda-alert')).toBeHidden()
    await page.getByRole('button', { name: 'Swipe right' }).click()

    await expect(page.locator('.soda-alert')).toBeVisible()
    await expect(page.locator('.soda-alert')).toHaveText('Swipe not saved')
    expect(attempts).toBe(2)

    await page.unroute('**/api/soda/swipes')
    await page.getByRole('button', { name: 'Swipe left' }).click()
    await expect(page.locator('.soda-alert')).toBeHidden()
  })
})
