import { describe, expect, test, vi } from 'vitest'
import { runWeeklyOrder } from './index'
import type { Bindings } from './types'

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
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain('INSERT OR IGNORE INTO soda_buy_lists')
    expect(writes[0].values[0]).toBe('2026-11-16')
  })
})
