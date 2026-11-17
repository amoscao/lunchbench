import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  checkCooldown,
  checkRateLimit,
  clearRateLimit,
  getClientIp,
  incrementRateLimit,
  peekRateLimit,
} from './rate-limit'

type RateLimitRow = {
  count: number
  window_start: string
}

function fakeDb(): D1Database {
  const rows = new Map<string, RateLimitRow>()

  return {
    prepare(sql: string) {
      let bound: unknown[] = []
      return {
        bind(...args: unknown[]) {
          bound = args
          return this
        },
        applyCooldownInsert() {
          const [key, action, nowStr, cooldownSeconds] = bound as [string, string, string, number]
          const rowKey = `${key}:${action}`
          const existing = rows.get(rowKey)
          const isActive = existing
            ? new Date(existing.window_start).getTime() + cooldownSeconds * 1000 > new Date(nowStr).getTime()
            : false

          if (isActive) return null

          const row = { count: 1, window_start: nowStr }
          rows.set(rowKey, row)
          return { window_start: row.window_start }
        },
        async run() {
          if (sql.includes('DELETE FROM rate_limits')) {
            const [key, action] = bound as [string, string]
            rows.delete(`${key}:${action}`)
            return
          }

          const [key, action, windowStart] = bound as [string, string, string]
          const rowKey = `${key}:${action}`
          const existing = rows.get(rowKey)

          rows.set(rowKey, {
            count: existing?.window_start === windowStart ? existing.count + 1 : 1,
            window_start: windowStart,
          })
        },
        async first() {
          if (sql.includes('RETURNING count, window_start')) {
            const [key, action, windowStart] = bound as [string, string, string]
            const rowKey = `${key}:${action}`
            const existing = rows.get(rowKey)
            const row = {
              count: existing?.window_start === windowStart ? existing.count + 1 : 1,
              window_start: windowStart,
            }
            rows.set(rowKey, row)
            return row
          }

          if (sql.includes('RETURNING window_start')) {
            return this.applyCooldownInsert()
          }

          const [key, action] = bound as [string, string]
          return rows.get(`${key}:${action}`) ?? null
        },
      }
    },
  } as unknown as D1Database
}

describe('checkRateLimit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('allows up to the limit and then returns retry seconds', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    const db = fakeDb()

    await expect(checkRateLimit(db, 'ip', 'vote', 1, 3600)).resolves.toEqual({ allowed: true })
    await expect(checkRateLimit(db, 'ip', 'vote', 1, 3600)).resolves.toEqual({
      allowed: false,
      retryAfter: 3000,
      action: 'vote',
      count: 2,
      limit: 1,
    })
  })

  test('resets counts in the next fixed window', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    const db = fakeDb()

    await checkRateLimit(db, 'pair', 'vote_pair', 1, 3600)
    await checkRateLimit(db, 'pair', 'vote_pair', 1, 3600)

    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'))

    await expect(checkRateLimit(db, 'pair', 'vote_pair', 1, 3600)).resolves.toEqual({
      allowed: true,
    })
  })

  test('clears a stored counter by key and action', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    const db = fakeDb()

    await checkRateLimit(db, 'pair', 'vote_pair', 1, 3600)
    await clearRateLimit(db, 'pair', 'vote_pair')

    await expect(checkRateLimit(db, 'pair', 'vote_pair', 1, 3600)).resolves.toEqual({
      allowed: true,
    })
  })

  test('peeks without incrementing the counter', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    const db = fakeDb()

    await expect(peekRateLimit(db, 'ip', 'admin_verify', 1, 3600)).resolves.toEqual({
      allowed: true,
    })
    await expect(peekRateLimit(db, 'ip', 'admin_verify', 1, 3600)).resolves.toEqual({
      allowed: true,
    })
    await expect(incrementRateLimit(db, 'ip', 'admin_verify', 1, 3600)).resolves.toEqual({
      allowed: true,
    })
  })

  test('peek blocks the attempt after the failed-attempt quota is spent', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    const db = fakeDb()

    await incrementRateLimit(db, 'ip', 'admin_verify', 1, 3600)

    await expect(peekRateLimit(db, 'ip', 'admin_verify', 1, 3600)).resolves.toEqual({
      allowed: false,
      retryAfter: 3000,
      action: 'admin_verify',
      count: 1,
      limit: 1,
    })
  })

  test('uses a rolling cooldown from the first accepted request', async () => {
    vi.setSystemTime(new Date('2026-01-01T23:59:00.000Z'))
    const db = fakeDb()

    await expect(checkCooldown(db, 'pair', 'vote_pair', 86400)).resolves.toEqual({
      allowed: true,
    })

    vi.setSystemTime(new Date('2026-01-02T00:01:00.000Z'))

    await expect(checkCooldown(db, 'pair', 'vote_pair', 86400)).resolves.toEqual({
      allowed: false,
      retryAfter: 86280,
    })
  })

  test('allows a cooldown key after the full cooldown expires', async () => {
    vi.setSystemTime(new Date('2026-01-01T23:59:00.000Z'))
    const db = fakeDb()

    await checkCooldown(db, 'pair', 'vote_pair', 86400)

    vi.setSystemTime(new Date('2026-01-02T23:59:00.000Z'))

    await expect(checkCooldown(db, 'pair', 'vote_pair', 86400)).resolves.toEqual({
      allowed: true,
    })
  })
})

// #307: the Worker trusts the proxy-forwarded visitor IP only with the right PROXY_SECRET.
describe('getClientIp', () => {
  const EDGE_IP = '2a06:98c0:3600::103'
  const VISITOR_IP = '203.0.113.42'
  const SECRET = 'proxy-secret-value'

  function request(headers: Record<string, string>): Request {
    return new Request('https://api.example/api/soda/swipes', { headers })
  }

  test('ignores a forwarded IP sent without the secret header', () => {
    const req = request({ 'CF-Connecting-IP': EDGE_IP, 'X-Lunchbench-Client-IP': VISITOR_IP })
    expect(getClientIp(req, SECRET)).toBe(EDGE_IP)
  })

  test('ignores a forwarded IP sent with the wrong secret', () => {
    for (const wrong of ['wrong-secret', SECRET.slice(0, -1), `${SECRET}x`, '']) {
      const req = request({
        'CF-Connecting-IP': EDGE_IP,
        'X-Lunchbench-Client-IP': VISITOR_IP,
        'X-Lunchbench-Proxy-Secret': wrong,
      })
      expect(getClientIp(req, SECRET)).toBe(EDGE_IP)
    }
  })

  test('uses the forwarded IP with the correct secret', () => {
    const req = request({
      'CF-Connecting-IP': EDGE_IP,
      'X-Lunchbench-Client-IP': ` ${VISITOR_IP} `,
      'X-Lunchbench-Proxy-Secret': SECRET,
    })
    expect(getClientIp(req, SECRET)).toBe(VISITOR_IP)
  })

  test('falls back to CF-Connecting-IP when the correct secret comes with no forwarded IP', () => {
    const req = request({ 'CF-Connecting-IP': EDGE_IP, 'X-Lunchbench-Client-IP': ' ', 'X-Lunchbench-Proxy-Secret': SECRET })
    expect(getClientIp(req, SECRET)).toBe(EDGE_IP)
  })

  test('with PROXY_SECRET unset, ignores both headers whatever they say', () => {
    const headers = {
      'CF-Connecting-IP': EDGE_IP,
      'X-Lunchbench-Client-IP': VISITOR_IP,
      'X-Lunchbench-Proxy-Secret': SECRET,
    }
    expect(getClientIp(request(headers), undefined)).toBe(EDGE_IP)
    expect(getClientIp(request(headers), '')).toBe(EDGE_IP)
    expect(getClientIp(request({ ...headers, 'X-Lunchbench-Proxy-Secret': '' }), '')).toBe(EDGE_IP)
  })

  test('keeps the old fallbacks when no proxy headers are sent', () => {
    expect(getClientIp(request({ 'CF-Connecting-IP': EDGE_IP }), SECRET)).toBe(EDGE_IP)
    expect(getClientIp(request({ 'X-Forwarded-For': `${VISITOR_IP}, 10.0.0.1` }), undefined)).toBe(VISITOR_IP)
    expect(getClientIp(request({}), SECRET)).toBe('unknown')
  })
})
