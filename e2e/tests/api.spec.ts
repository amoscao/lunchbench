import { test, expect } from '@playwright/test'
import { ADMIN_TOKEN, API_URL } from './helpers'

test.describe('API', () => {
  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/health`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('GET /api/matchup returns two lunches', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/matchup`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.left).toBeDefined()
    expect(body.right).toBeDefined()
    expect(body.left.id).not.toBe(body.right.id)
  })

  test('GET /api/lunches/leaderboard returns ranked lunches', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/lunches/leaderboard`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.lunches).toBeInstanceOf(Array)
    expect(body.lunches.length).toBeGreaterThan(0)
    expect(body.lunches[0].rank).toBe(1)
  })

  test('POST /api/vote updates ratings', async ({ request }) => {
    const matchupRes = await request.get(`${API_URL}/api/matchup`)
    const { left, right } = await matchupRes.json()

    const voteRes = await request.post(`${API_URL}/api/vote`, {
      data: { left_lunch_id: left.id, right_lunch_id: right.id, result: 'left_win' },
    })
    expect(voteRes.ok()).toBe(true)
    const voteBody = await voteRes.json()
    expect(voteBody.vote_id).toBeDefined()

    const lbRes = await request.get(`${API_URL}/api/lunches/leaderboard`)
    const { lunches } = await lbRes.json()
    const updatedLeft = lunches.find((l: any) => l.id === left.id)
    const updatedRight = lunches.find((l: any) => l.id === right.id)
    expect(updatedLeft.rating).not.toBe(left.rating)
    expect(updatedRight.rating).not.toBe(right.rating)
    expect(updatedLeft.wins).toBe(left.wins + 1)
    expect(updatedRight.losses).toBe(right.losses + 1)
  })

  test('POST /api/vote with tie updates both records', async ({ request }) => {
    const matchupRes = await request.get(`${API_URL}/api/matchup`)
    const { left, right } = await matchupRes.json()

    const voteRes = await request.post(`${API_URL}/api/vote`, {
      data: { left_lunch_id: left.id, right_lunch_id: right.id, result: 'tie' },
    })
    expect(voteRes.ok()).toBe(true)

    const lbRes = await request.get(`${API_URL}/api/lunches/leaderboard`)
    const { lunches } = await lbRes.json()
    const updatedLeft = lunches.find((l: any) => l.id === left.id)
    const updatedRight = lunches.find((l: any) => l.id === right.id)
    expect(updatedLeft.ties).toBe(left.ties + 1)
    expect(updatedRight.ties).toBe(right.ties + 1)
  })

  test('POST /api/vote rejects invalid result', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/vote`, {
      data: { left_lunch_id: 1, right_lunch_id: 2, result: 'invalid' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/lunches requires auth', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/lunches`, {
      data: { name: 'Unauthorized Lunch' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/lunches creates lunch with valid token', async ({ request }) => {
    const uniqueName = `API Test Lunch ${Date.now()}`
    const res = await request.post(`${API_URL}/api/lunches`, {
      data: { name: uniqueName },
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.lunch.name).toBe(uniqueName)
    expect(body.lunch.rating).toBe(1000)
  })

  test('POST /api/lunches rejects empty name', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/lunches`, {
      data: { name: '' },
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/lunches/:id/image rejects non-image file', async ({ request }) => {
    const createRes = await request.post(`${API_URL}/api/lunches`, {
      data: { name: `Image Test Lunch ${Date.now()}` },
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    const { lunch } = await createRes.json()

    const fakeFile = Buffer.from('this is not an image')
    const res = await request.post(`${API_URL}/api/lunches/${lunch.id}/image`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      multipart: {
        image: {
          name: 'test.jpg',
          mimeType: 'image/jpeg',
          buffer: fakeFile,
        },
      },
    })
    expect(res.status()).toBe(415)
  })

  test('GET /api/images/:key returns 404 for missing image', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/images/images/nonexistent-key.jpg`)
    expect(res.status()).toBe(404)
  })
})
