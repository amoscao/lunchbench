import type { D1Database } from '@cloudflare/workers-types'

export async function checkRateLimit(
  db: D1Database,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000)
  const windowStartStr = windowStart.toISOString()

  // Upsert rate limit row
  await db.prepare(`
    INSERT INTO rate_limits (key, action, count, window_start)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key, action) DO UPDATE SET
      count = CASE
        WHEN window_start = excluded.window_start THEN count + 1
        ELSE 1
      END,
      window_start = excluded.window_start
  `).bind(key, action, windowStartStr).run()

  const row = await db.prepare(
    'SELECT count, window_start FROM rate_limits WHERE key = ? AND action = ?'
  ).bind(key, action).first<{ count: number; window_start: string }>()

  if (!row) return { allowed: true }

  if (row.count > limit) {
    const windowEnd = new Date(new Date(row.window_start).getTime() + windowSeconds * 1000)
    const retryAfter = Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)
    return { allowed: false, retryAfter }
  }

  return { allowed: true }
}

export async function clearRateLimit(
  db: D1Database,
  key: string,
  action: string
): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ? AND action = ?')
    .bind(key, action)
    .run()
}

export async function checkCooldown(
  db: D1Database,
  key: string,
  action: string,
  cooldownSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date()
  const nowStr = now.toISOString()

  const acquired = await db.prepare(`
    INSERT INTO rate_limits (key, action, count, window_start)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key, action) DO UPDATE SET
      count = 1,
      window_start = excluded.window_start
      WHERE unixepoch(rate_limits.window_start) + ? <= unixepoch(excluded.window_start)
    RETURNING window_start
  `).bind(key, action, nowStr, cooldownSeconds).first<{ window_start: string }>()

  if (acquired) return { allowed: true }

  const row = await db.prepare(
    'SELECT window_start FROM rate_limits WHERE key = ? AND action = ?'
  ).bind(key, action).first<{ window_start: string }>()

  if (!row) return { allowed: false, retryAfter: cooldownSeconds }

  const windowEnd = new Date(new Date(row.window_start).getTime() + cooldownSeconds * 1000)
  const retryAfter = Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)
  return { allowed: false, retryAfter }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
