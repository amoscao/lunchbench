import { test, expect, type Page } from '@playwright/test'
import { API_URL, getSodaRow } from './helpers'

async function sodaIdByName(name: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/soda/catalog`)
  const { sodas } = await res.json() as { sodas: { id: number; name: string }[] }
  const soda = sodas.find((s) => s.name === name)
  if (!soda) throw new Error(`No soda named ${name}`)
  return soda.id
}

async function openReport(page: Page) {
  await page.getByRole('button', { name: 'Report a soda' }).click()
  const dialog = page.getByRole('dialog', { name: 'Report a soda' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function pick(page: Page, query: string, name: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Report a soda' })
  await dialog.getByRole('combobox').fill(query)
  await dialog.locator('.soda-suggest-item', { hasText: name }).click()
  await expect(dialog.getByRole('combobox')).toHaveValue(name)
}

test.describe('Sodabench report a soda', () => {
  test('Like and Hate stay disabled until a drink is picked', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    const like = dialog.getByRole('button', { name: 'Like' })
    const hate = dialog.getByRole('button', { name: 'Hate' })

    await expect(like).toBeDisabled()
    await expect(hate).toBeDisabled()

    await dialog.getByRole('combobox').fill('Coca')
    await expect(dialog.locator('.soda-suggest-item').first()).toBeVisible()
    await expect(like).toBeDisabled()

    await dialog.locator('.soda-suggest-item', { hasText: 'Coca-Cola Zero Sugar' }).click()
    await expect(like).toBeEnabled()
    await expect(hate).toBeEnabled()

    await dialog.getByRole('combobox').fill('Coca-Cola Zero Suga')
    await expect(like).toBeDisabled()
  })

  test('submitting Like closes the modal and records the report', async ({ page }) => {
    const id = await sodaIdByName('Sprite Original')
    const before = await getSodaRow(id)

    await page.goto('/soda')
    const dialog = await openReport(page)
    await pick(page, 'sprite', 'Sprite Original')
    await dialog.getByRole('button', { name: 'Like' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.locator('.alert:visible')).toHaveCount(0)
    await expect.poll(async () => (await getSodaRow(id)).likes).toBe(before.likes + 1)
  })

  test('a newer report from the same voter replaces the older one', async ({ page }) => {
    const id = await sodaIdByName('Dr Pepper Original')
    const before = await getSodaRow(id)

    await page.goto('/soda')
    let dialog = await openReport(page)
    await pick(page, 'pepper', 'Dr Pepper Original')
    await dialog.getByRole('button', { name: 'Like' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await getSodaRow(id)).likes).toBe(before.likes + 1)

    dialog = await openReport(page)
    await pick(page, 'pepper', 'Dr Pepper Original')
    await dialog.getByRole('button', { name: 'Hate' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => {
      const row = await getSodaRow(id)
      return [row.likes, row.hates]
    }).toEqual([before.likes, before.hates + 1])
  })

  test('keyboard picks a suggestion and Escape closes without reporting', async ({ page }) => {
    let reports = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/soda/reports')) reports += 1
    })

    await page.goto('/soda')
    const dialog = await openReport(page)
    await dialog.getByRole('combobox').fill('polar')
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('combobox')).toHaveValue(/^Polar /)
    await expect(dialog.getByRole('button', { name: 'Like' })).toBeEnabled()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(reports).toBe(0)
  })

  test('arrow keys in the report field do not swipe the deck', async ({ page }) => {
    await page.goto('/soda')
    const label = page.locator('.soda-progress-label')
    await expect(label).toHaveText(/^1 \//)
    const dialog = await openReport(page)
    await dialog.getByRole('combobox').fill('lime')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await expect(label).toHaveText(/^1 \//)
  })

  test('Tab stays inside the dialog and Escape closes it from any control', async ({ page }) => {
    await page.goto('/soda')
    const dialog = await openReport(page)
    await pick(page, 'sprite', 'Sprite Original')

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }

    await dialog.getByRole('button', { name: 'Hate' }).focus()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Report a soda' })).toBeFocused()
  })
})
