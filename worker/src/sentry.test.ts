import { afterEach, describe, expect, test, vi } from 'vitest'
import { app } from './index'
import { resetRateLimitReports } from './rate-limit'
import type { Bindings } from './types'

// #262: a 429 on POST /api/admin/verify goes to Sentry through the real app and SDK. The event must not
// carry the raw IP, the request body (the typed password), the Authorization header or the voter session.
const RAW_IP = '203.0.113.42'
const PASSWORD = 'typed-password-attempt'
const BEARER = 'bearer-token-value'
const SESSION = '550e8400-e29b-41d4-a716-446655440000'

function env(dsn: string): Bindings {
  return {
    // Every rate_limits read says the admin_verify quota is spent.
    DB: {
      prepare() {
        return { bind() { return { async first() { return { count: 5, window_start: new Date().toISOString() } } } } }
      },
    } as unknown as D1Database,
    IMAGES: undefined,
    VOTE_PASSWORD: 'lunch-password',
    ADMIN_MANAGER_PASSWORD: 'admin-password',
    SENTRY_DSN: dsn,
    IP_HASH_KEY: 'test-ip-hash-key',
  }
}

async function blockedVerify(dsn: string): Promise<{ status: number; sent: string[] }> {
  resetRateLimitReports()
  const sent: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = init?.body
    sent.push(typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array))
    return new Response('{}', { status: 200 })
  }))
  const waits: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} }
  const res = await app.fetch(new Request('https://api.example/api/admin/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': RAW_IP,
      'X-Forwarded-For': RAW_IP,
      Authorization: `Bearer ${BEARER}`,
      'X-Lunchbench-Session': SESSION,
      Cookie: 'a=b',
    },
    body: JSON.stringify({ password: PASSWORD }),
  }), env(dsn), ctx as unknown as ExecutionContext)
  await Promise.allSettled(waits)
  await vi.waitFor(() => {
    if (dsn && sent.length === 0) throw new Error('nothing sent yet')
  }, { timeout: 2000 })
  return { status: res.status, sent }
}

describe('rate-limit Sentry event through the real app', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('sends one warning with the tags and no IP, body, credentials or session', async () => {
    const { status, sent } = await blockedVerify('https://abc123@o1.ingest.sentry.io/1')
    expect(status).toBe(429)

    const envelope = sent.join('\n')
    expect(envelope).toContain('"level":"warning"')
    expect(envelope).toContain('Rate limit exceeded')
    expect(envelope).toContain('"rate_limit_action":"admin_verify"')
    expect(envelope).toContain('"route":"POST /api/admin/verify"')
    expect(envelope).toMatch(/"ip_hash":"[0-9a-f]{16}"/)
    expect(envelope).toContain('"limit":5')
    for (const secret of [RAW_IP, PASSWORD, BEARER, SESSION, 'a=b']) {
      expect(envelope).not.toContain(secret)
    }
  })

  test('with an empty SENTRY_DSN nothing is sent and nothing fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { status, sent } = await blockedVerify('')
    expect(status).toBe(429)
    expect(sent).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })
})
