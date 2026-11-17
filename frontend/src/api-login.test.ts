import { afterEach, describe, expect, test, vi } from 'vitest'
import { verifySessionForRoles } from './api'

function mockVerify(role: string) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.endsWith('/admin/verify')) {
      return new Response(JSON.stringify({ token: 'minted-token', role }), { status: 200 })
    }
    return new Response(JSON.stringify({ revoked: true }), { status: 200 })
  }))
  return calls
}

describe('verifySessionForRoles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns the token for an allowed role', async () => {
    const calls = mockVerify('purchaser')
    await expect(verifySessionForRoles('pw', ['purchaser', 'admin'])).resolves.toBe('minted-token')
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  test('revokes a wrong-role session and reports an invalid password', async () => {
    const calls = mockVerify('lunch')
    await expect(verifySessionForRoles('pw', ['purchaser', 'admin'])).rejects.toThrow('Invalid password')
    expect(calls).toEqual([
      { url: '/api/admin/verify', method: 'POST' },
      { url: '/api/admin/session', method: 'DELETE' },
    ])
  })

  test('a purchaser password is not a lunch login', async () => {
    mockVerify('purchaser')
    await expect(verifySessionForRoles('pw', ['admin', 'lunch'])).rejects.toThrow('Invalid password')
  })
})
