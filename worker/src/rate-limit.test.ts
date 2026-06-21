import { afterEach, describe, expect, test, vi } from 'vitest'
import { checkCooldown, checkRateLimit, clearRateLimit } from './rate-limit'

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
        async run() {
          if (sql.includes('DELETE FROM rate_limits')) {
            const [key, action] = bound as [string, string]
            rows.delete(`${key}:${action}`)
            return
          }

          if (sql.includes('unixepoch(window_start)')) {
            const [key, action, nowStr, cooldownSeconds] = bound as [string, string, string, number]
            const rowKey = `${key}:${action}`
            const existing = rows.get(rowKey)
            const isActive = existing
              ? new Date(existing.window_start).getTime() + cooldownSeconds * 1000 > new Date(nowStr).getTime()
              : false

            rows.set(rowKey, {
              count: isActive && existing ? existing.count + 1 : 1,
              window_start: isActive && existing ? existing.window_start : nowStr,
            })
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
