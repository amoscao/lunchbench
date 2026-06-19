import { test, expect } from '@playwright/test'
import { ADMIN_TOKEN } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

test.describe('Add Lunch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/add')
  })

  test('page loads with heading and three mode tabs', async ({ page }) => {
    await expect(page.locator('.page-heading')).toHaveText('Add Lunch')
    const modeBtns = page.locator('.mode-btn')
    await expect(modeBtns).toHaveCount(3)
  })

  test('mode tabs have correct labels', async ({ page }) => {
    const modeBtns = page.locator('.mode-btn')
    await expect(modeBtns.nth(0)).toContainText('New Lunch')
    await expect(modeBtns.nth(1)).toContainText('New Lunch + Image')
    await expect(modeBtns.nth(2)).toContainText('Add Image to Existing')
  })

  test('first mode is active by default', async ({ page }) => {
    const firstMode = page.locator('.mode-btn').nth(0)
    await expect(firstMode).toHaveClass(/active/)
  })

  test('clicking mode tabs switches active state', async ({ page }) => {
    const secondMode = page.locator('.mode-btn').nth(1)
    await secondMode.click()
    await expect(secondMode).toHaveClass(/active/)

    const firstMode = page.locator('.mode-btn').nth(0)
    await expect(firstMode).not.toHaveClass(/active/)
  })

  test('text-only mode shows name input and token field', async ({ page }) => {
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('adding lunch without admin token shows error', async ({ page }) => {
    await page.fill('input[type="text"]', 'Test Lunch')
    await page.locator('button.btn-primary').click()
    await expect(page.locator('.alert-error')).toBeVisible()
  })

  test('adding lunch with wrong admin token shows error', async ({ page }) => {
    await page.fill('input[type="text"]', 'Test Lunch Wrong Token')
    await page.fill('input[type="password"]', 'wrong-token')
    await page.locator('button.btn-primary').click()
    await page.waitForTimeout(2000)
    await expect(page.locator('.alert-error')).toBeVisible()
  })

  test('adding lunch with empty name shows error', async ({ page }) => {
    await page.fill('input[type="password"]', ADMIN_TOKEN)
    await page.locator('button.btn-primary').click()
    await expect(page.locator('.alert-error')).toBeVisible()
  })

  test('adding lunch with correct token succeeds', async ({ page }) => {
    const uniqueName = `E2E Test Lunch ${Date.now()}`
    await page.fill('input[type="text"]', uniqueName)
    await page.fill('input[type="password"]', ADMIN_TOKEN)
    await page.locator('button.btn-primary').click()
    await page.waitForTimeout(2000)
    await expect(page.locator('.alert-success')).toBeVisible()
  })

  test('newly added lunch appears on leaderboard', async ({ page }) => {
    const uniqueName = `E2E Leaderboard Lunch ${Date.now()}`
    await page.fill('input[type="text"]', uniqueName)
    await page.fill('input[type="password"]', ADMIN_TOKEN)
    await page.locator('button.btn-primary').click()
    await page.waitForTimeout(2000)

    await page.goto('/leaderboard')
    await page.waitForTimeout(1500)
    await expect(page.locator('body')).toContainText(uniqueName)
  })

  test('image upload mode shows upload area', async ({ page }) => {
    await page.locator('.mode-btn').nth(1).click()
    await expect(page.locator('.upload-area')).toBeVisible()
  })

  test('add image to existing mode shows lunch dropdown', async ({ page }) => {
    await page.locator('.mode-btn').nth(2).click()
    await page.waitForTimeout(1500)
    await expect(page.locator('select')).toBeVisible()
  })

  test('client-side validation rejects wrong file type', async ({ page }) => {
    await page.locator('.mode-btn').nth(1).click()

    const tmpFile = path.join(os.tmpdir(), `lunchbench-e2e-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'not an image')

    try {
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles(tmpFile)

      await page.fill('input[type="text"]', 'Test Lunch Image')
      await page.fill('input[type="password"]', ADMIN_TOKEN)
      await page.locator('button.btn-primary').click()

      await page.waitForTimeout(500)
      await expect(page.locator('.alert-error')).toBeVisible()
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('client-side validation shows image preview for valid file', async ({ page }) => {
    await page.locator('.mode-btn').nth(1).click()

    const tmpFile = path.join(os.tmpdir(), `lunchbench-e2e-${Date.now()}.jpg`)
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xFF, 0xDB, 0x00, 0x43, 0x00,
      ...Array(64).fill(0x10),
      0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
      0xFF, 0xC4, 0x00, 0x1F, 0x00,
      ...Array(29).fill(0x00),
      0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
      0x7F, 0xFF, 0xD9,
    ])
    fs.writeFileSync(tmpFile, jpegHeader)

    try {
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles(tmpFile)

      await page.waitForTimeout(500)
      const preview = page.locator('.upload-preview')
      await expect(preview).toBeVisible()
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})
