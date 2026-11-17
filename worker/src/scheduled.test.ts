import { describe, expect, test, vi } from 'vitest'
import { runWeeklyOrder } from './index'
import type { Bindings } from './types'
import { createTestD1 } from '../test/sqlite-d1'

function env(db: Partial<D1Database>): Bindings {
  return {
    DB: db as D1Database,
    IMAGES: undefined,
    VOTE_PASSWORD: '',
    ADMIN_MANAGER_PASSWORD: '',
    SENTRY_DSN: '',
  }
}

const controller = { cron: '0 12 * * 1', scheduledTime: Date.parse('2026-11-16T12:00:00Z') } as ScheduledController

describe('weekly cron', () => {
  test('logs and rethrows when the snapshot write fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = env({
      prepare() {
        throw new Error('D1 unavailable')
      },
    })

    await expect(runWeeklyOrder(controller, failing)).rejects.toThrow('D1 unavailable')
    expect(log).toHaveBeenCalledWith('Weekly soda order failed', '0 12 * * 1', expect.any(Error))
    log.mockRestore()
  })

  test('writes the week snapshot with INSERT OR IGNORE', async () => {
    const writes: { sql: string; values: unknown[] }[] = []
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = []
        const statement = {
          bind(...values: unknown[]) {
            bound = values
            return statement
          },
          async all() {
            return { results: [] }
          },
          async run() {
            writes.push({ sql, values: bound })
            return { success: true, meta: { changes: 1 } }
          },
        }
        return statement
      },
    }

    await runWeeklyOrder(controller, env(db as unknown as D1Database))
    expect(writes).toHaveLength(3)
    expect(writes[0].sql).toContain('INSERT OR IGNORE INTO soda_buy_lists')
    expect(writes[0].values[0]).toBe('2026-11-16')
    expect(writes[1].sql).toContain("DELETE FROM soda_unknown_scans WHERE created_at < datetime('now', '-180 days')")
    expect(writes[2].sql).toContain('DELETE FROM rate_limits')
  })

  test('prunes rate-limit rows older than a day and keeps recent ones (#307)', async () => {
    const { db, sqlite } = createTestD1()
    const insert = sqlite.prepare('INSERT INTO rate_limits (key, action, count, window_start) VALUES (?, ?, ?, ?)')
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
    insert.run('203.0.113.1', 'soda_swipe', 3, hoursAgo(25))
    insert.run('203.0.113.2', 'soda_swipe', 3, hoursAgo(1))
    insert.run('203.0.113.3', 'admin_verify', 2, hoursAgo(23))

    await runWeeklyOrder(controller, env(db))
    const keys = sqlite.prepare('SELECT key FROM rate_limits ORDER BY key').all().map((r) => r.key)
    expect(keys).toEqual(['203.0.113.2', '203.0.113.3'])
  })
})
