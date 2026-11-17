import type { D1Database } from '@cloudflare/workers-types'
import type { Context } from 'hono'
import { routePath } from 'hono/route'
import { captureMessage } from '@sentry/cloudflare'
import type { Bindings } from './types'
import { constantTimeEquals } from './helpers'

/** A blocked result carries what the 429 report needs (#262). */
export type RateLimitBlocked = {
  allowed: false
  retryAfter: number
  action: string
  count: number
  limit: number
}
export type RateLimitResult = { allowed: true } | RateLimitBlocked
type RateLimitRow = { count: number; window_start: string }

function getWindowStart(now: Date, windowSeconds: number): string {
  return new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000
  ).toISOString()
}

function getRateLimitResult(
  row: RateLimitRow | null,
  now: Date,
  action: string,
  limit: number,
  windowSeconds: number,
  blockAtLimit: boolean
): RateLimitResult {
  if (!row) return { allowed: true }

  const windowEnd = new Date(new Date(row.window_start).getTime() + windowSeconds * 1000)
  if (windowEnd <= now) return { allowed: true }

  const overLimit = blockAtLimit ? row.count >= limit : row.count > limit
  if (overLimit) {
    const retryAfter = Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)
    return { allowed: false, retryAfter, action, count: row.count, limit }
  }

  return { allowed: true }
}

export async function peekRateLimit(
  db: D1Database,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date()

  const row = await db.prepare(
    'SELECT count, window_start FROM rate_limits WHERE key = ? AND action = ?'
  ).bind(key, action).first<RateLimitRow>()

  return getRateLimitResult(row, now, action, limit, windowSeconds, true)
}

export async function incrementRateLimit(
  db: D1Database,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date()
  const windowStartStr = getWindowStart(now, windowSeconds)

  const row = await db.prepare(`
    INSERT INTO rate_limits (key, action, count, window_start)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key, action) DO UPDATE SET
      count = CASE
        WHEN window_start = excluded.window_start THEN count + 1
        ELSE 1
      END,
      window_start = excluded.window_start
    RETURNING count, window_start
  `).bind(key, action, windowStartStr).first<RateLimitRow>()

  return getRateLimitResult(row, now, action, limit, windowSeconds, false)
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  return incrementRateLimit(db, key, action, limit, windowSeconds)
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

// The Pages Function proxy (frontend/functions/api/[[path]].ts) fetches this Worker, so the
// Worker's CF-Connecting-IP is a Cloudflare egress address shared by every visitor (#307). The
// proxy forwards the visitor IP in CLIENT_IP_HEADER plus PROXY_SECRET in PROXY_SECRET_HEADER.
// Keep both names in sync with the proxy.
export const CLIENT_IP_HEADER = 'X-Lunchbench-Client-IP'
export const PROXY_SECRET_HEADER = 'X-Lunchbench-Proxy-Secret'

/**
 * The visitor IP for rate limits, barcode learning and the 429 IP hash. CLIENT_IP_HEADER is
 * trusted only when PROXY_SECRET is set and PROXY_SECRET_HEADER matches it, so a direct caller of
 * the workers.dev URL cannot pick an IP. Anything else falls back to CF-Connecting-IP.
 */
export function getClientIp(request: Request, proxySecret: string | undefined): string {
  if (proxySecret) {
    const sentSecret = request.headers.get(PROXY_SECRET_HEADER)
    const forwardedIp = request.headers.get(CLIENT_IP_HEADER)?.trim()
    if (sentSecret && forwardedIp && constantTimeEquals(sentSecret, proxySecret)) return forwardedIp
  }
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

// Fallback HMAC key when IP_HASH_KEY is unset (local dev, tests): random per isolate, so hashes
// still never reveal the IP but only correlate within one isolate.
let isolateIpHashKey: string | null = null
let cachedHmacKey: { raw: string; key: Promise<CryptoKey> } | null = null

/**
 * HMAC-SHA-256 of the client IP, first 16 hex chars. Keyed so the hash cannot be reversed by
 * hashing every IPv4 address. The same key gives the same hash, so repeat offenders group.
 */
export async function hashClientIp(ip: string, key: string | undefined): Promise<string> {
  if (!key) {
    isolateIpHashKey ??= crypto.randomUUID()
    key = isolateIpHashKey
  }
  const encoder = new TextEncoder()
  if (cachedHmacKey?.raw !== key) {
    cachedHmacKey = {
      raw: key,
      key: crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    }
  }
  const mac = await crypto.subtle.sign('HMAC', await cachedHmacKey.key, encoder.encode(ip))
  return Array.from(new Uint8Array(mac).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

// At most one Sentry report per action and IP hash per minute in each isolate, so a client
// hammering a limited route cannot burn the Sentry event quota. The 429s themselves are unchanged.
export const RATE_LIMIT_REPORT_INTERVAL_MS = 60_000
const MAX_REPORT_KEYS = 1000
const lastReportAt = new Map<string, number>()

function shouldReport(key: string, now: number): boolean {
  const last = lastReportAt.get(key)
  if (last !== undefined && now - last < RATE_LIMIT_REPORT_INTERVAL_MS) return false
  if (lastReportAt.size >= MAX_REPORT_KEYS) lastReportAt.clear()
  lastReportAt.set(key, now)
  return true
}

/** Test hook: forget report times. */
export function resetRateLimitReports(): void {
  lastReportAt.clear()
}

/**
 * The 429 response for a blocked rate-limit check. Every 429 goes through here and is reported to
 * Sentry as a warning (throttled, see above): route, action, count, limit and a keyed IP hash,
 * never the raw IP. With no SENTRY_DSN the Sentry client is disabled and the capture does nothing.
 * Reporting never changes the response.
 */
export async function rateLimitedResponse(
  c: Context<{ Bindings: Bindings }>,
  blocked: RateLimitBlocked,
  error: string
): Promise<Response> {
  try {
    const ip = getClientIp(c.req.raw, c.env.PROXY_SECRET)
    const ipHash = ip === 'unknown' ? 'unknown' : await hashClientIp(ip, c.env.IP_HASH_KEY)
    if (shouldReport(`${blocked.action}:${ipHash}`, Date.now())) {
      captureMessage('Rate limit exceeded', {
        level: 'warning',
        fingerprint: ['rate-limited', blocked.action],
        tags: {
          route: `${c.req.method} ${routePath(c)}`,
          rate_limit_action: blocked.action,
          ip_hash: ipHash,
        },
        extra: { count: blocked.count, limit: blocked.limit },
      })
    }
  } catch (e) {
    console.error('Rate limit report failed', e)
  }
  return c.json({ error, code: 'RATE_LIMITED' }, 429)
}
