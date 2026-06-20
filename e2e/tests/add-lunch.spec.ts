import { test, expect } from '@playwright/test'
import { ADMIN_TOKEN } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

test.describe('Add Lunch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/add')
  })

  test('page loads with heading and two mode tabs', async ({ page }) => {
    await expect(page.locator('.page-heading')).toHaveText('Add Lunch')
    const modeBtns = page.locator('.mode-btn')
    await expect(modeBtns).toHaveCount(2)
  })

  test('mode tabs have correct labels', async ({ page }) => {
    const modeBtns = page.locator('.mode-btn')
    await expect(modeBtns.nth(0)).toContainText('New Lunch')
    await expect(modeBtns.nth(1)).toContainText('Add Image to Existing')
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

  test('text-only mode shows name input and password field', async ({ page }) => {
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('label.form-label', { hasText: 'Password' })).toBeVisible()
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
    await expect(page.locator('.upload-area')).toBeVisible()
  })

  test('add image to existing mode shows searchable lunch input', async ({ page }) => {
    await page.locator('.mode-btn').nth(1).click()
    await page.waitForTimeout(1500)
    await expect(page.locator('label.form-label', { hasText: 'Select Lunch' })).toBeVisible()
    await expect(page.locator('.search-dropdown-wrap input[placeholder="Search lunches…"]')).toBeVisible()
  })

  test('client-side validation rejects wrong file type', async ({ page }) => {
    const tmpFile = path.join(os.tmpdir(), `lunchbench-e2e-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'not an image')

    try {
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles(tmpFile)
      await page.waitForTimeout(300)
      // Validation fires before the crop modal — error shown immediately
      await expect(page.locator('.alert-error')).toBeVisible()
      // Crop modal should NOT appear
      await expect(page.locator('.crop-backdrop')).toHaveCount(0)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('crop modal appears after selecting valid image', async ({ page }) => {
    const tmpFile = path.join(os.tmpdir(), `lunchbench-e2e-${Date.now()}.png`)
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==',
      'base64'
    )
    fs.writeFileSync(tmpFile, png1x1)

    try {
      await page.locator('input[type="file"]').setInputFiles(tmpFile)
      await expect(page.locator('.crop-backdrop')).toBeVisible()
      await expect(page.locator('.crop-title')).toContainText('Crop')
      await expect(page.locator('.crop-actions .btn-primary')).toBeEnabled()
      // Cancel dismisses the modal
      await page.locator('.crop-actions .btn-secondary').click()
      await expect(page.locator('.crop-backdrop')).toHaveCount(0)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  test('client-side validation shows image preview for valid file', async ({ page }) => {
    const tmpFile = path.join(os.tmpdir(), `lunchbench-e2e-${Date.now()}.png`)
    // Minimal valid 1×1 grayscale PNG
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==',
      'base64'
    )
    fs.writeFileSync(tmpFile, png1x1)

    try {
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles(tmpFile)

      // Crop modal should open
      await expect(page.locator('.crop-backdrop')).toBeVisible()
      // Wait for image to load and confirm button to enable
      await expect(page.locator('.crop-actions .btn-primary')).toBeEnabled()
      await page.locator('.crop-actions .btn-primary').click()

      await page.waitForTimeout(500)
      const preview = page.locator('.upload-preview')
      await expect(preview).toBeVisible()
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})
