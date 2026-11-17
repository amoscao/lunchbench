import { describe, expect, test, vi } from 'vitest'
import { adminRouter } from './admin'
import type { Bindings } from '../types'

type InsertedSession = {
  token: string
  expiresAt: string
  role: string
}

function mockEnv(inserted: InsertedSession[]): Bindings {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                return null
              },
              async run() {
                if (sql.includes('INSERT OR REPLACE INTO admin_sessions')) {
                  inserted.push({
                    token: values[0] as string,
                    expiresAt: values[1] as string,
                    role: values[2] as string,
                  })
                }
                return { success: true, meta: { changes: 1 } }
              },
            }
          },
        }
      },
    } as unknown as D1Database,
    IMAGES: undefined,
    VOTE_PASSWORD: 'lunch-password',
    ADMIN_MANAGER_PASSWORD: 'admin-password',
    SENTRY_DSN: '',
  }
}

describe('admin verify', () => {
  test('mints a one-year lunch session', async () => {
    const inserted: InsertedSession[] = []
    vi.setSystemTime(new Date('2026-07-23T12:00:00.000Z'))

    try {
      const response = await adminRouter.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'lunch-password' }),
      }, mockEnv(inserted))

      expect(response.status).toBe(200)
      expect(inserted).toHaveLength(1)
      expect(inserted[0].role).toBe('lunch')
      expect(new Date(inserted[0].expiresAt).toISOString()).toBe('2027-07-23T12:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
})
