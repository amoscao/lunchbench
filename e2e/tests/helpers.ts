import { Page } from '@playwright/test'

export const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? 'test-admin-token'
export const API_URL = process.env.API_URL ?? 'http://localhost:8787'

export async function waitForMatchup(page: Page): Promise<void> {
  await page.waitForSelector('.vote-arena', { timeout: 15000 })
  await page.waitForSelector('.vote-buttons', { timeout: 5000 })
}

export async function castVote(page: Page, which: 'left' | 'tie' | 'right'): Promise<void> {
  await waitForMatchup(page)
  const buttons = page.locator('.vote-buttons .btn')
  if (which === 'left') await buttons.nth(0).click()
  else if (which === 'tie') await buttons.nth(1).click()
  else await buttons.nth(2).click()
  await page.waitForTimeout(500)
}

export async function addLunchViaAPI(name: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/lunches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`Failed to add lunch: ${res.status}`)
  const data = await res.json() as { lunch: { id: number } }
  return data.lunch.id
}
