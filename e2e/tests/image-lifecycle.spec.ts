import { test, expect } from '@playwright/test'
import { API_URL, addLunchViaAPI, getAdminSessionToken, waitForMatchup } from './helpers'

type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
  rank: number
  rating: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

type ImageUploadResponse = {
  image_key: string
  image_url: string
}

const ONE_BY_ONE_WHITE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
  'base64',
)

async function getLunchViaAPI(id: number): Promise<Lunch> {
  const res = await fetch(`${API_URL}/api/lunches/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch lunch ${id}: ${res.status}`)
  return res.json() as Promise<Lunch>
}

async function uploadImageViaAPI(id: number): Promise<ImageUploadResponse> {
  const token = await getAdminSessionToken()
  const form = new FormData()
  form.append('image', new Blob([ONE_BY_ONE_WHITE_JPEG], { type: 'image/jpeg' }), 'white-pixel.jpg')

  const res = await fetch(`${API_URL}/api/lunches/${id}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Failed to upload lunch image: ${res.status}`)
  return res.json() as Promise<ImageUploadResponse>
}

function absoluteApiUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, API_URL).toString()
}

function projectedResult(left: Lunch, right: Lunch) {
  return {
    left_win: {
      left: { rating: left.rating, conservative_rating: left.conservative_rating, rank: left.rank },
      right: { rating: right.rating, conservative_rating: right.conservative_rating, rank: right.rank },
    },
    right_win: {
      left: { rating: left.rating, conservative_rating: left.conservative_rating, rank: left.rank },
      right: { rating: right.rating, conservative_rating: right.conservative_rating, rank: right.rank },
    },
    tie: {
      left: { rating: left.rating, conservative_rating: left.conservative_rating, rank: left.rank },
      right: { rating: right.rating, conservative_rating: right.conservative_rating, rank: right.rank },
    },
  }
}

test.describe('Image lifecycle', () => {
  let noImageLunchId: number
  let noImageLunchName: string
  let imageLunchId: number
  let comparisonLunchId: number
  let upload: ImageUploadResponse

  test.beforeAll(async () => {
    const suffix = Date.now()
    noImageLunchName = `No Image Lunch ${suffix}`
    noImageLunchId = await addLunchViaAPI(noImageLunchName)
    imageLunchId = await addLunchViaAPI(`Image Lunch ${suffix}`)
    comparisonLunchId = await addLunchViaAPI(`Image Comparison Lunch ${suffix}`)
    upload = await uploadImageViaAPI(imageLunchId)
  })

  test('add lunch without image shows leaderboard row and detail placeholder', async ({ page }) => {
    await page.goto('/leaderboard')
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: noImageLunchName })).toBeVisible()
    await expect(page.locator('.leaderboard-table tbody tr', { hasText: noImageLunchName }).locator('img')).toHaveCount(0)

    await page.goto(`/lunch/${noImageLunchId}`)
    await expect(page.locator('.detail-name')).toContainText(noImageLunchName)
    await expect(page.locator('.detail-image-placeholder')).toBeVisible()
    await expect(page.locator('.detail-image')).toHaveCount(0)
  })

  test('add image after creation renders in detail page and arena', async ({ page }) => {
    expect(upload.image_url.trim().length).toBeGreaterThan(0)

    const imageLunch = await getLunchViaAPI(imageLunchId)
    const comparisonLunch = await getLunchViaAPI(comparisonLunchId)
    expect(new URL(imageLunch.image_url ?? '', API_URL).pathname).toBe(new URL(upload.image_url, API_URL).pathname)

    await page.goto(`/lunch/${imageLunchId}`)
    const detailImage = page.locator('img.detail-image')
    await expect(detailImage).toBeVisible()
    await expect(detailImage).toHaveAttribute('src', /\/api\/images\//)

    await page.route('/api/matchup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          left: imageLunch,
          right: comparisonLunch,
          projected: projectedResult(imageLunch, comparisonLunch),
        }),
      })
    })

    await page.goto('/')
    await waitForMatchup(page)
    const arenaImage = page.locator('.vote-arena .lunch-card', { hasText: imageLunch.name }).locator('img')
    await expect(arenaImage).toBeVisible()
    await expect(arenaImage).toHaveAttribute('src', /\/api\/images\//)
  })

  test('image URL returns bytes', async () => {
    expect(upload.image_url.trim().length).toBeGreaterThan(0)

    const res = await fetch(absoluteApiUrl(upload.image_url))
    expect(res.status).toBe(200)

    const body = await res.arrayBuffer()
    expect(body.byteLength).toBeGreaterThan(0)
  })
})
