import { test, expect, APIRequestContext } from '@playwright/test'
import { ADMIN_TOKEN, API_URL } from './helpers'
import fs from 'fs'
import path from 'path'
import os from 'os'

const K = 32

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

function calculateElo(
  ratingA: number,
  ratingB: number,
  result: 'a_wins' | 'b_wins' | 'tie'
): { newA: number; newB: number } {
  const eA = expectedScore(ratingA, ratingB)
  const eB = expectedScore(ratingB, ratingA)
  const sA = result === 'a_wins' ? 1 : result === 'b_wins' ? 0 : 0.5
  const sB = 1 - sA

  return {
    newA: ratingA + K * (sA - eA),
    newB: ratingB + K * (sB - eB),
  }
}

function minimalJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xdb, 0x00, 0x43, 0x00,
    0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09,
    0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13,
    0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24,
    0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c,
    0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c,
    0x2e, 0x33, 0x34, 0x32,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
    0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04,
    0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03,
    0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61,
    0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1,
    0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34,
    0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
    0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
    0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93,
    0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
    0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
    0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5,
    0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7,
    0xf8, 0xf9, 0xfa,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xfb, 0x5a, 0xff, 0xd9,
  ])
}

function minimalPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}

function minimalWebp(): Buffer {
  return Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
}

type LunchState = {
  id: number
  name: string
  rating: number
  wins: number
  losses: number
  ties: number
  hasImage: boolean
  is_vegan: boolean
}

type CreatedLunch = {
  id: number
  name: string
  rating: number
  wins: number
  losses: number
  ties: number
}

function e2eHeaders(testRunId: string | number): Record<string, string> {
  const numericId = Number(testRunId)
  const thirdOctet = Number.isFinite(numericId) ? Math.floor(numericId / 254) % 254 : 113
  const fourthOctet = Number.isFinite(numericId) ? (numericId % 254) + 1 : 1
  return { 'CF-Connecting-IP': `198.51.${thirdOctet}.${fourthOctet}` }
}

async function createLunch(
  request: APIRequestContext,
  name: string,
  description: string,
  is_vegan = false,
  testRunId = Date.now()
): Promise<CreatedLunch> {
  const res = await request.post(`${API_URL}/api/lunches`, {
    data: { name, description, is_vegan },
    headers: {
      ...e2eHeaders(testRunId),
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
  })
  expect(res.ok(), `Create lunch '${name}' failed: ${res.status()} ${await res.text()}`).toBe(true)
  const data = await res.json()
  return data.lunch
}

async function uploadImage(
  request: APIRequestContext,
  lunchId: number,
  imagePath: string,
  mimeType: string,
  testRunId: number
): Promise<void> {
  const res = await request.post(`${API_URL}/api/lunches/${lunchId}/image`, {
    headers: {
      ...e2eHeaders(testRunId),
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    multipart: {
      image: {
        name: path.basename(imagePath),
        mimeType,
        buffer: fs.readFileSync(imagePath),
      },
    },
  })
  expect(res.ok(), `Upload image for lunch ${lunchId} failed: ${res.status()} ${await res.text()}`).toBe(true)
}

async function castApiVote(
  request: APIRequestContext,
  leftId: number,
  rightId: number,
  result: 'left_win' | 'right_win' | 'tie',
  testRunId: number
): Promise<void> {
  const res = await request.post(`${API_URL}/api/vote`, {
    data: { left_lunch_id: leftId, right_lunch_id: rightId, result },
    headers: e2eHeaders(testRunId),
  })
  expect(res.ok(), `Vote failed: ${res.status()} ${await res.text()}`).toBe(true)
}

test.describe('Comprehensive Integration - Elo Correctness', () => {
  test('full integration: add, image upload, voting, Elo verification', async ({ request, page }) => {
    const testRunId = Date.now()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunchbench-integration-'))
    const lunches: Record<string, LunchState> = {}

    try {
      const imageFiles = {
        jpeg: path.join(tmpDir, 'pizza.jpg'),
        png: path.join(tmpDir, 'salad.png'),
        webp: path.join(tmpDir, 'tacos.webp'),
      }
      fs.writeFileSync(imageFiles.jpeg, minimalJpeg())
      fs.writeFileSync(imageFiles.png, minimalPng())
      fs.writeFileSync(imageFiles.webp, minimalWebp())

      const lunchDefs = [
        { name: `INT Pizza ${testRunId}`, description: 'A classic margherita', is_vegan: false },
        { name: `INT Tacos ${testRunId}`, description: 'Street-style tacos', is_vegan: false },
        { name: `INT Salad ${testRunId}`, description: 'Fresh garden salad', is_vegan: true },
        { name: `INT Burger ${testRunId}`, description: 'Juicy beef burger', is_vegan: false },
        { name: `INT Burrito ${testRunId}`, description: 'Veggie burrito bowl', is_vegan: true },
        { name: `INT Sushi ${testRunId}`, description: 'Salmon nigiri', is_vegan: false },
      ]

      for (const def of lunchDefs) {
        const lunch = await createLunch(request, def.name, def.description, def.is_vegan, testRunId)
        lunches[def.name] = {
          id: lunch.id,
          name: def.name,
          rating: 1000,
          wins: 0,
          losses: 0,
          ties: 0,
          hasImage: false,
          is_vegan: def.is_vegan,
        }
      }

      const names = Object.keys(lunches)
      expect(names.length).toBe(6)

      await uploadImage(request, lunches[names[0]].id, imageFiles.jpeg, 'image/jpeg', testRunId)
      lunches[names[0]].hasImage = true

      await uploadImage(request, lunches[names[1]].id, imageFiles.webp, 'image/webp', testRunId)
      lunches[names[1]].hasImage = true

      await uploadImage(request, lunches[names[2]].id, imageFiles.png, 'image/png', testRunId)
      lunches[names[2]].hasImage = true

      const lunchRes = await request.get(`${API_URL}/api/lunches`)
      expect(lunchRes.ok()).toBe(true)
      const { lunches: allLunches } = await lunchRes.json()
      for (const name of names.slice(0, 3)) {
        const found = allLunches.find((l: any) => l.id === lunches[name].id)
        expect(found?.image_key, `${name} should have an image_key`).toBeTruthy()
      }

      const voteScript: [string, string, 'left_win' | 'right_win' | 'tie'][] = [
        [names[0], names[1], 'left_win'],
        [names[0], names[2], 'left_win'],
        [names[1], names[2], 'right_win'],
        [names[3], names[4], 'tie'],
        [names[0], names[3], 'right_win'],
        [names[4], names[5], 'left_win'],
        [names[1], names[5], 'right_win'],
        [names[2], names[5], 'left_win'],
        [names[3], names[5], 'left_win'],
        [names[0], names[4], 'left_win'],
        [names[1], names[3], 'right_win'],
        [names[2], names[4], 'tie'],
        [names[0], names[5], 'left_win'],
        [names[1], names[2], 'left_win'],
        [names[3], names[4], 'right_win'],
        [names[0], names[1], 'right_win'],
        [names[2], names[5], 'right_win'],
        [names[3], names[5], 'tie'],
        [names[0], names[2], 'right_win'],
        [names[4], names[1], 'left_win'],
      ]

      for (const [leftName, rightName, result] of voteScript) {
        const left = lunches[leftName]
        const right = lunches[rightName]
        const eloResult = result === 'left_win' ? 'a_wins' : result === 'right_win' ? 'b_wins' : 'tie'
        const { newA, newB } = calculateElo(left.rating, right.rating, eloResult)

        left.rating = newA
        right.rating = newB

        if (result === 'left_win') {
          left.wins++
          right.losses++
        } else if (result === 'right_win') {
          right.wins++
          left.losses++
        } else {
          left.ties++
          right.ties++
        }

        await castApiVote(request, left.id, right.id, result, testRunId)
      }

      const lbRes = await request.get(`${API_URL}/api/lunches/leaderboard`)
      expect(lbRes.ok()).toBe(true)
      const { lunches: leaderboard } = await lbRes.json()
      const ourIds = new Set(Object.values(lunches).map((l) => l.id))
      const ourLeaderboard = leaderboard.filter((l: any) => ourIds.has(l.id))

      expect(ourLeaderboard.length).toBe(6)

      for (const apiLunch of ourLeaderboard) {
        const expected = Object.values(lunches).find((l) => l.id === apiLunch.id)
        expect(expected, `Lunch id ${apiLunch.id} not found in expected state`).toBeTruthy()
        expect(apiLunch.rating, `Rating mismatch for ${expected!.name}`).toBe(expected!.rating)
        expect(apiLunch.wins, `Wins mismatch for ${expected!.name}`).toBe(expected!.wins)
        expect(apiLunch.losses, `Losses mismatch for ${expected!.name}`).toBe(expected!.losses)
        expect(apiLunch.ties, `Ties mismatch for ${expected!.name}`).toBe(expected!.ties)
      }

      const expectedSorted = Object.values(lunches).sort((a, b) => b.rating - a.rating)
      for (let i = 0; i < expectedSorted.length; i++) {
        expect(
          ourLeaderboard[i].id,
          `Position ${i + 1} mismatch: expected ${expectedSorted[i].name} but got ${ourLeaderboard[i].name}`
        ).toBe(expectedSorted[i].id)
      }

      for (const lunch of ourLeaderboard) {
        const expected = Object.values(lunches).find((l) => l.id === lunch.id)!
        if (expected.hasImage) {
          expect(lunch.image_key, `${expected.name} should have image_key`).toBeTruthy()
          expect(lunch.image_url, `${expected.name} should have image_url`).toBeTruthy()
          const imagePath = new URL(lunch.image_url).pathname
          const imgRes = await request.get(`${API_URL}${imagePath}`)
          expect(imgRes.ok(), `Image for ${expected.name} should be accessible`).toBe(true)
        } else {
          expect(lunch.image_key, `${expected.name} should NOT have image_key`).toBeFalsy()
        }
      }

      const veganLbRes = await request.get(`${API_URL}/api/lunches/leaderboard?vegan=true`)
      expect(veganLbRes.ok()).toBe(true)
      const { lunches: veganLb } = await veganLbRes.json()
      const ourVeganLb = veganLb.filter((l: any) => ourIds.has(l.id))

      const expectedVegan = expectedSorted.filter((l) => l.is_vegan)
      expect(ourVeganLb.length).toBe(expectedVegan.length)
      for (let i = 0; i < expectedVegan.length; i++) {
        expect(ourVeganLb[i].id).toBe(expectedVegan[i].id)
        expect(ourVeganLb[i].is_vegan, `${ourVeganLb[i].name} should be vegan`).toBe(1)
      }

      const ourVeganIds = new Set(ourVeganLb.map((l: any) => l.id))
      for (const lunch of Object.values(lunches)) {
        if (!lunch.is_vegan) {
          expect(ourVeganIds.has(lunch.id), `${lunch.name} should NOT appear in vegan leaderboard`).toBe(false)
        }
      }

      await page.goto('/')
      await page.waitForSelector('.vote-arena', { timeout: 15000 })

      await page.goto('/leaderboard')
      await page.waitForSelector('.leaderboard-table tbody tr', { timeout: 15000 })

      const topLunch = expectedSorted[0]
      const matchingRows = page.locator('.leaderboard-table tbody tr', { hasText: topLunch.name })
      await expect(matchingRows.first()).toBeVisible()

      const firstBadge = page.locator('.rank-badge').first()
      await expect(firstBadge).toHaveClass(/gold/)

      const thumbImages = page.locator('.lunch-thumb')
      expect(await thumbImages.count()).toBeGreaterThanOrEqual(3)

      await page.goto('/')
      await page.waitForSelector('.vote-arena', { timeout: 15000 })

      const cards = page.locator('.lunch-card')
      await expect(cards).toHaveCount(2)

      const leftName = await page.locator('.lunch-card-name').nth(0).textContent()
      const rightName = await page.locator('.lunch-card-name').nth(1).textContent()
      expect(leftName?.trim().length).toBeGreaterThan(0)
      expect(rightName?.trim().length).toBeGreaterThan(0)
      expect(leftName?.trim()).not.toBe(rightName?.trim())

      console.log('\n=== Integration Test Results ===')
      console.log('Expected ratings after 20 votes:')
      for (const lunch of expectedSorted) {
        console.log(
          `  ${lunch.name.padEnd(30)} rating=${lunch.rating.toFixed(2).padStart(8)} ` +
          `W=${lunch.wins} L=${lunch.losses} T=${lunch.ties} ` +
          `vegan=${lunch.is_vegan} img=${lunch.hasImage}`
        )
      }
      console.log('=================================\n')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('vegan-only matchup returns only vegan lunches', async ({ request }) => {
    const ts = Date.now()
    await createLunch(request, `Vegan Test ${ts}`, 'Pure vegan', true, ts)
    await createLunch(request, `Vegan Test2 ${ts}`, 'Also vegan', true, ts)

    const res = await request.get(`${API_URL}/api/matchup?vegan=true`)
    if (res.status() === 204) return

    expect(res.ok()).toBe(true)
    const { left, right } = await res.json()
    expect(left.is_vegan).toBe(1)
    expect(right.is_vegan).toBe(1)
    expect(left.id).not.toBe(right.id)
  })

  test('image upload rejection is correct', async ({ request }) => {
    const ts = Date.now()
    const lunchesRes = await request.get(`${API_URL}/api/lunches`)
    expect(lunchesRes.ok()).toBe(true)
    const { lunches } = await lunchesRes.json()
    const lunch = lunches[0]
    expect(lunch?.id).toBeTruthy()

    const res1 = await request.post(`${API_URL}/api/lunches/${lunch.id}/image`, {
      headers: {
        ...e2eHeaders(ts),
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      multipart: {
        image: { name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('This is not an image at all') },
      },
    })
    expect(res1.status()).toBe(415)
    const errBody = await res1.json()
    expect(errBody.code).toBe('INVALID_IMAGE')

    const res2 = await request.post(`${API_URL}/api/lunches/${lunch.id}/image`, {
      headers: {
        ...e2eHeaders(ts),
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      multipart: {
        image: { name: 'valid.jpg', mimeType: 'image/jpeg', buffer: minimalJpeg() },
      },
    })
    expect(res2.ok(), `Valid JPEG upload failed: ${res2.status()} ${await res2.text()}`).toBe(true)
    const data = await res2.json()
    expect(data.image_key).toBeTruthy()

    const imgRes = await request.get(`${API_URL}/api/images/${data.image_key}`)
    expect(imgRes.ok()).toBe(true)
  })

  test('admin authentication validates password input', async ({ request }) => {
    const badAuth = await request.post(`${API_URL}/api/admin/verify`, {
      data: {},
    })
    expect(badAuth.status()).toBe(400)
    const body = await badAuth.json()
    expect(body.code).toBe('BAD_REQUEST')
  })
})
