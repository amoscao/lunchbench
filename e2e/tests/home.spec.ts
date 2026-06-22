import { test, expect } from '@playwright/test'
import { waitForMatchup, castVote, API_URL } from './helpers'

type LunchSnapshot = {
  id: number
  name: string
  rating: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
}

async function getLunchSnapshot(id: number): Promise<LunchSnapshot> {
  const res = await fetch(`${API_URL}/api/lunches/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch lunch ${id}: ${res.status}`)
  const lunch = await res.json() as LunchSnapshot
  return {
    id: lunch.id,
    name: lunch.name,
    rating: lunch.rating,
    conservative_rating: lunch.conservative_rating,
    wins: lunch.wins,
    losses: lunch.losses,
    ties: lunch.ties,
  }
}

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

  test('four vote buttons are present', async ({ page }) => {
    await waitForMatchup(page)

    const buttons = page.locator('.vote-buttons .btn')
    await expect(buttons).toHaveCount(4)
  })

  test('left vote button label is A wins', async ({ page }) => {
    await waitForMatchup(page)

    const leftBtn = page.locator('.vote-buttons .btn').nth(0)
    await expect(leftBtn).toHaveText('A wins')
  })

  test('tie button is labeled Tie', async ({ page }) => {
    await waitForMatchup(page)
    const tieBtn = page.locator('.vote-buttons .btn').nth(1)
    await expect(tieBtn).toHaveText('Tie')
  })

  test('right vote button label is B wins', async ({ page }) => {
    await waitForMatchup(page)
    const rightBtn = page.locator('.vote-buttons .btn').nth(2)
    await expect(rightBtn).toHaveText('B wins')
  })

  test("skip button is labeled Haven't Eaten", async ({ page }) => {
    await waitForMatchup(page)
    const skipBtn = page.locator('.vote-buttons .btn').nth(3)
    await expect(skipBtn).toHaveText("Haven't Eaten")
  })

  test('skipping a matchup loads the next pair without writing a vote', async ({ page }) => {
    let voteRequested = false
    let initialMatchup: { left: LunchSnapshot; right: LunchSnapshot } | null = null

    await page.route('/api/vote', async (route) => {
      voteRequested = true
      await route.abort()
    })
    await page.route('/api/matchup**', async (route) => {
      const response = await route.fetch()
      if (response.status() === 200) {
        const body = await response.json() as { left: LunchSnapshot; right: LunchSnapshot }
        initialMatchup ??= body
        await route.fulfill({ response, json: body })
        return
      }
      await route.fulfill({ response })
    })

    await page.goto('/')
    await waitForMatchup(page)
    expect(initialMatchup).not.toBeNull()

    const names = page.locator('.lunch-card-name')
    const initialNames = [
      (await names.nth(0).textContent())?.trim(),
      (await names.nth(1).textContent())?.trim(),
    ]

    const beforeLeft = await getLunchSnapshot(initialMatchup!.left.id)
    const beforeRight = await getLunchSnapshot(initialMatchup!.right.id)

    await page.locator('.vote-buttons .btn').nth(3).click()

    await expect.poll(async () => {
      const currentNames = [
        (await names.nth(0).textContent())?.trim(),
        (await names.nth(1).textContent())?.trim(),
      ]
      return currentNames.join('|')
    }).not.toBe(initialNames.join('|'))

    expect(voteRequested).toBe(false)
    expect(await getLunchSnapshot(beforeLeft.id)).toEqual(beforeLeft)
    expect(await getLunchSnapshot(beforeRight.id)).toEqual(beforeRight)
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
