import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { captureMessage } from '@sentry/cloudflare'
import {
  hashClientIp,
  RATE_LIMIT_REPORT_INTERVAL_MS,
  rateLimitedResponse,
  resetRateLimitReports,
  type RateLimitBlocked,
} from './rate-limit'
import type { Bindings } from './types'

// #262: every 429 is reported to Sentry as a warning, with a keyed IP hash and never the raw IP.
vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn() }))
const capture = vi.mocked(captureMessage)

const RAW_IP = '203.0.113.42'
const BLOCKED: RateLimitBlocked = { allowed: false, retryAfter: 1200, action: 'soda_swipe', count: 1201, limit: 1200 }

function env(ipHashKey?: string): Bindings {
  return {
    DB: {} as D1Database,
    IMAGES: undefined,
    VOTE_PASSWORD: 'lunch-password',
    ADMIN_MANAGER_PASSWORD: 'admin-password',
    SENTRY_DSN: '',
    IP_HASH_KEY: ipHashKey,
  }
}

const app = new Hono<{ Bindings: Bindings }>()
const api = new Hono<{ Bindings: Bindings }>()
api.put('/swipes', (c) => rateLimitedResponse(c, BLOCKED, 'Too many swipes'))
app.route('/api/soda', api)

function swipe(headers: Record<string, string>, ipHashKey = 'test-ip-hash-key'): Promise<Response> {
  return Promise.resolve(app.request('/api/soda/swipes', { method: 'PUT', headers }, env(ipHashKey)))
}

describe('rateLimitedResponse', () => {
  beforeEach(() => {
    capture.mockReset()
    resetRateLimitReports()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns the usual 429 body and sends one warning with route, action, count, limit and IP hash', async () => {
    const res = await swipe({ 'CF-Connecting-IP': RAW_IP })

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many swipes', code: 'RATE_LIMITED' })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('Rate limit exceeded', {
      level: 'warning',
      fingerprint: ['rate-limited', 'soda_swipe'],
      tags: {
        route: 'PUT /api/soda/swipes',
        rate_limit_action: 'soda_swipe',
        ip_hash: await hashClientIp(RAW_IP, 'test-ip-hash-key'),
      },
      extra: { count: 1201, limit: 1200 },
    })
  })

  test('never sends the raw IP, from either IP header', async () => {
    await swipe({ 'CF-Connecting-IP': RAW_IP })
    resetRateLimitReports()
    await swipe({ 'X-Forwarded-For': `${RAW_IP}, 10.0.0.1` })

    expect(capture).toHaveBeenCalledTimes(2)
    const sent = JSON.stringify(capture.mock.calls)
    expect(sent).not.toContain(RAW_IP)
    expect(sent).not.toContain('203.0.113')
    const [first, second] = capture.mock.calls.map((call) => (call[1] as { tags: { ip_hash: string } }).tags.ip_hash)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(second).toBe(first)
  })

  test('the hash is keyed: same IP and key match, another key or IP does not', async () => {
    const hash = await hashClientIp(RAW_IP, 'key-a')
    expect(await hashClientIp(RAW_IP, 'key-a')).toBe(hash)
    expect(await hashClientIp(RAW_IP, 'key-b')).not.toBe(hash)
    expect(await hashClientIp('203.0.113.43', 'key-a')).not.toBe(hash)
  })

  test('without IP_HASH_KEY it still hashes, with a per-isolate random key', async () => {
    const hash = await hashClientIp(RAW_IP, undefined)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(await hashClientIp(RAW_IP, undefined)).toBe(hash)
    expect(await hashClientIp(RAW_IP, '')).toBe(hash)
  })

  test('reports at most once per action and IP per interval; every request still gets 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'))
    for (let i = 0; i < 3; i++) expect((await swipe({ 'CF-Connecting-IP': RAW_IP })).status).toBe(429)
    expect(capture).toHaveBeenCalledTimes(1)

    expect((await swipe({ 'CF-Connecting-IP': '198.51.100.7' })).status).toBe(429)
    expect(capture).toHaveBeenCalledTimes(2)

    vi.setSystemTime(new Date(Date.now() + RATE_LIMIT_REPORT_INTERVAL_MS))
    await swipe({ 'CF-Connecting-IP': RAW_IP })
    expect(capture).toHaveBeenCalledTimes(3)
  })

  test('a request with no IP header reports ip_hash "unknown"', async () => {
    await swipe({})
    expect((capture.mock.calls[0][1] as { tags: { ip_hash: string } }).tags.ip_hash).toBe('unknown')
  })

  test('a failing report does not change the 429', async () => {
    capture.mockImplementation(() => {
      throw new Error('sentry down')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const res = await swipe({ 'CF-Connecting-IP': RAW_IP })
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'Too many swipes', code: 'RATE_LIMITED' })
    } finally {
      error.mockRestore()
    }
  })
})

describe('every 429 goes through rateLimitedResponse', () => {
  test('no other worker source builds a 429 or a RATE_LIMITED body', () => {
    const src = fileURLToPath(new URL('.', import.meta.url))
    const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'rate-limit.ts')
      .filter((file) => /,\s*429\s*\)|['"]RATE_LIMITED['"]/.test(readFileSync(join(src, file), 'utf8')))
    expect(offenders).toEqual([])
  })
})
