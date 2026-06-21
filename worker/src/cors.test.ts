import { describe, expect, test } from 'vitest'
import app from './index'
import type { Bindings } from './types'

const env: Bindings = {
  DB: {} as D1Database,
  IMAGES: undefined,
  VOTE_PASSWORD: 'test-admin-token',
  ADMIN_MANAGER_PASSWORD: 'test-admin-password',
  SENTRY_DSN: '',
}

async function preflight(path: string, origin: string, method = 'POST'): Promise<Response> {
  return app.request(
    path,
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'Content-Type',
      },
    },
    env
  )
}

describe('CORS', () => {
  test('allows the production Pages origin on vote routes', async () => {
    const res = await preflight('/api/vote', 'https://lunchbench.pages.dev')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://lunchbench.pages.dev')
  })

  test('allows Cloudflare Pages preview origins', async () => {
    const res = await preflight('/api/vote', 'https://abc123.lunchbench.pages.dev')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://abc123.lunchbench.pages.dev')
  })

  test('allows local frontend origins', async () => {
    const res = await preflight('/api/admin/verify', 'http://localhost:5173')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  test('allows Docker E2E frontend origin', async () => {
    const res = await preflight('/api/vote', 'http://frontend:5173')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://frontend:5173')
  })

  test('does not allow arbitrary origins on vote routes', async () => {
    const res = await preflight('/api/vote', 'https://evil.example')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('rejects actual browser requests from arbitrary origins before route handling', async () => {
    const res = await app.request(
      '/api/vote',
      {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify({ left_lunch_id: 1, right_lunch_id: 2, result: 'left_win' }),
      },
      env
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden', code: 'FORBIDDEN' })
  })

  test('allows non-browser API clients with no origin', async () => {
    const res = await app.request('/api/health', { method: 'GET' }, env)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  test('does not allow arbitrary lunchbench.xyz subdomains', async () => {
    const res = await preflight('/api/vote', 'https://attacker.lunchbench.xyz')

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
