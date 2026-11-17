import { describe, expect, test } from 'vitest'
import { app } from './index'
import { createTestD1 } from '../test/sqlite-d1'
import type { Bindings } from './types'

// #307: through the real app and real SQL, the admin_verify failed-password limit (5 per hour) is
// counted per visitor when the Pages proxy forwards the visitor IP with the right PROXY_SECRET.
const EDGE_IP = '2a06:98c0:3600::103'
const SECRET = 'proxy-secret-value'

function env(db: D1Database, proxySecret?: string): Bindings {
  return {
    DB: db,
    IMAGES: undefined,
    VOTE_PASSWORD: 'lunch-password',
    ADMIN_MANAGER_PASSWORD: 'admin-password',
    SENTRY_DSN: '',
    PROXY_SECRET: proxySecret,
  }
}

async function wrongPassword(bindings: Bindings, headers: Record<string, string>): Promise<number> {
  const res = await app.request('/api/admin/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': EDGE_IP, ...headers },
    body: JSON.stringify({ password: 'wrong' }),
  }, bindings)
  return res.status
}

const viaProxy = (ip: string, secret = SECRET) => ({ 'X-Lunchbench-Client-IP': ip, 'X-Lunchbench-Proxy-Secret': secret })

describe('per-visitor rate-limit buckets', () => {
  test('one proxied visitor locked out does not lock out another', async () => {
    const { db, sqlite } = createTestD1()
    const bindings = env(db, SECRET)
    for (let i = 0; i < 5; i++) expect(await wrongPassword(bindings, viaProxy('203.0.113.1'))).toBe(401)
    expect(await wrongPassword(bindings, viaProxy('203.0.113.1'))).toBe(429)
    expect(await wrongPassword(bindings, viaProxy('203.0.113.2'))).toBe(401)

    const keys = sqlite.prepare("SELECT key FROM rate_limits WHERE action = 'admin_verify' ORDER BY key").all().map((r) => r.key)
    expect(keys).toEqual(['203.0.113.1', '203.0.113.2'])
  })

  test('a forwarded IP with a wrong secret, or with PROXY_SECRET unset, counts against CF-Connecting-IP', async () => {
    for (const [bindingsSecret, sentSecret] of [[SECRET, 'wrong-secret'], [undefined, SECRET]] as const) {
      const { db, sqlite } = createTestD1()
      const bindings = env(db, bindingsSecret)
      for (let i = 0; i < 5; i++) {
        expect(await wrongPassword(bindings, viaProxy(`198.51.100.${i + 1}`, sentSecret))).toBe(401)
      }
      expect(await wrongPassword(bindings, viaProxy('198.51.100.99', sentSecret))).toBe(429)

      const keys = sqlite.prepare('SELECT key FROM rate_limits').all().map((r) => r.key)
      expect(keys).toEqual([EDGE_IP])
    }
  })
})
