import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import type { Bindings, LunchRow } from '../types'
import {
  constantTimeEquals,
  findMatchingAdminSession,
  lunchFromRow,
  validateAdminSession,
  type SessionRole,
} from '../helpers'
import { incrementRateLimit, getClientIp, peekRateLimit, rateLimitedResponse } from '../rate-limit'
import { bannedSodaSql, isSodaBanned, shownSodaSql, writeWeeklyOrder } from '../soda-data'
import { normalizeBarcode } from '../barcode'
import { sodaName } from '../soda-score'
import { groupUnknownScans, type CodeMapping, type UnknownScanRow } from '../soda-unknown-scans'

type AdminEnv = { Bindings: Bindings }
const ADMIN_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000

const admin = new Hono<{ Bindings: Bindings }>()

admin.post('/verify', async (c) => {
  const ip = getClientIp(c.req.raw, c.env.PROXY_SECRET)
  const rl = await peekRateLimit(c.env.DB, ip, 'admin_verify', 5, 3600)
  if (!rl.allowed) return rateLimitedResponse(c, rl, 'Too many attempts')

  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}))
  if (!body.password) {
    return c.json({ error: 'Password required', code: 'BAD_REQUEST' }, 400)
  }

  const pw = body.password
  if (!c.env.ADMIN_MANAGER_PASSWORD && !c.env.VOTE_PASSWORD && !c.env.PURCHASER_PASSWORD) {
    return c.json({ error: 'Admin password not configured', code: 'SERVER_ERROR' }, 500)
  }

  const adminMatches = c.env.ADMIN_MANAGER_PASSWORD
    ? constantTimeEquals(pw, c.env.ADMIN_MANAGER_PASSWORD)
    : false
  const lunchMatches = c.env.VOTE_PASSWORD
    ? constantTimeEquals(pw, c.env.VOTE_PASSWORD)
    : false
  const purchaserMatches = c.env.PURCHASER_PASSWORD
    ? constantTimeEquals(pw, c.env.PURCHASER_PASSWORD)
    : false

  let role: SessionRole | null = null
  if (adminMatches) {
    role = 'admin'
  } else if (lunchMatches) {
    role = 'lunch'
  } else if (purchaserMatches) {
    role = 'purchaser'
  }

  if (!role) {
    await incrementRateLimit(c.env.DB, ip, 'admin_verify', 5, 3600)
    return c.json({ error: 'Invalid password', code: 'UNAUTHORIZED' }, 401)
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString()
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO admin_sessions (token, expires_at, role) VALUES (?, ?, ?)'
  ).bind(token, expiresAt, role).run()

  return c.json({ token, role })
})

admin.delete('/session', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const token = auth.slice(7)
  const session = await findMatchingAdminSession(c.env.DB, token)
  if (session === null) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(session.token).run()

  return c.json({ revoked: true })
})

async function requireAdminSession(c: Context<AdminEnv>, next: Next): Promise<Response | void> {
  const hasSession = await validateAdminSession(c.req.raw, c.env.DB, 'admin')
  if (!hasSession) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  await next()
}

admin.get('/lunches', requireAdminSession, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM lunches ORDER BY id ASC'
  ).all<LunchRow>()
  return c.json({
    lunches: result.results.map((r) => lunchFromRow(r)),
  })
})

admin.patch('/lunches/:id', requireAdminSession, async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)

  const body = await c.req.json<{
    name?: string
    description?: string | null
    is_vegan?: boolean
  }>().catch((): { name?: string; description?: string | null; is_vegan?: boolean } => ({}))

  const updates: string[] = []
  const values: (string | number | null)[] = []

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name || name.length > 100) {
      return c.json({ error: 'Invalid name', code: 'BAD_REQUEST' }, 400)
    }
    updates.push('name = ?')
    values.push(name)
  }

  if (body.description !== undefined) {
    updates.push('description = ?')
    values.push(body.description)
  }

  if (body.is_vegan !== undefined) {
    updates.push('is_vegan = ?')
    values.push(body.is_vegan ? 1 : 0)
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update', code: 'BAD_REQUEST' }, 400)
  }

  updates.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  await c.env.DB.prepare(
    `UPDATE lunches SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run()

  const row = await c.env.DB.prepare('SELECT * FROM lunches WHERE id = ?').bind(id).first<LunchRow>()
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  return c.json({ lunch: lunchFromRow(row) })
})

admin.delete('/lunches/:id', requireAdminSession, async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM votes WHERE left_lunch_id = ? OR right_lunch_id = ?').bind(id, id),
    c.env.DB.prepare('DELETE FROM lunches WHERE id = ?').bind(id),
  ])

  return c.json({ deleted: true })
})

admin.get('/stats', requireAdminSession, async (c) => {
  const now = new Date()
  const ts24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const ts7d  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString()
  const ts30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [r24h, r7d, r30d] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts24h),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts7d),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM votes WHERE created_at >= ?').bind(ts30d),
  ])

  return c.json({
    votes_24h: (r24h.results[0] as { n: number }).n,
    votes_7d:  (r7d.results[0]  as { n: number }).n,
    votes_30d: (r30d.results[0] as { n: number }).n,
  })
})

admin.post('/reset-scores', requireAdminSession, async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE lunches SET
        rating              = 1500.0,
        glicko_rd           = 350.0,
        glicko_volatility   = 0.06,
        conservative_rating = 800.0,
        wins                = 0,
        losses              = 0,
        ties                = 0,
        updated_at          = ?
    `).bind(new Date().toISOString()),
    c.env.DB.prepare('DELETE FROM votes'),
  ])
  return c.json({ reset: true })
})

admin.post('/soda/regenerate', requireAdminSession, async (c) => {
  const weekStart = await writeWeeklyOrder(c.env.DB, new Date(), 'replace')
  return c.json({ week_start: weekStart })
})

// Unknown-scan log grouped by barcode. Never returns session keys, only distinct-voter counts.
admin.get('/soda/unknown-scans', requireAdminSession, async (c) => {
  const [scans, mapped, sodas] = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT code, format, session_key, created_at, resolved_soda_id, resolved_by FROM soda_unknown_scans'
    ),
    c.env.DB.prepare(
      'SELECT code, soda_id, source FROM soda_barcodes WHERE code IN (SELECT code FROM soda_unknown_scans)'
    ),
    c.env.DB.prepare(`SELECT s.id, s.brand, s.flavor, s.is_active, (${bannedSodaSql('s')}) AS banned FROM sodas s`),
  ])
  const groups = groupUnknownScans(
    scans.results as UnknownScanRow[],
    new Map((mapped.results as (CodeMapping & { code: string })[]).map((row) => [row.code, { soda_id: row.soda_id, source: row.source }])),
    // Inactive (e.g. OLIPOP, #296) and banned (#298) drinks stay nameable in old picks but are marked,
    // so an admin sees why they cannot be mapped to.
    new Map((sodas.results as { id: number; brand: string; flavor: string; is_active: number; banned: number }[])
      .map((row) => [row.id, `${sodaName(row)}${!row.is_active ? ' (removed)' : row.banned ? ' (banned)' : ''}`]))
  )
  return c.json({ codes: groups }, 200, { 'Cache-Control': 'no-store' })
})

// Drinks auto-banned by Hate reports (SODA_BAN_HATES distinct voters). Computed from reports, never stored.
admin.get('/soda/banned', requireAdminSession, async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT s.id, s.brand, s.flavor,
       SUM(CASE WHEN r.verdict = 'hate' THEN 1 ELSE 0 END) AS hates,
       SUM(CASE WHEN r.verdict = 'like' THEN 1 ELSE 0 END) AS likes
     FROM sodas s
     JOIN soda_reports r ON r.soda_id = s.id
     WHERE s.is_active = 1 AND ${bannedSodaSql('s')}
     GROUP BY s.id
     ORDER BY hates DESC, s.brand ASC, s.flavor ASC`
  ).all<{ id: number; brand: string; flavor: string; hates: number; likes: number }>()
  return c.json({
    banned: result.results.map((row) => ({
      id: row.id,
      name: `${row.brand} ${row.flavor}`,
      hates: row.hates,
      likes: row.likes,
    })),
  }, 200, { 'Cache-Control': 'no-store' })
})

// Lifts an auto-ban. Records the drink's current Hate count, so it stays shown until it gets
// SODA_BAN_HATES new Hates (see soda_ban_overrides). Only a currently banned, active drink can be unbanned.
admin.post('/soda/banned/:id/unban', requireAdminSession, async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'BAD_REQUEST' }, 400)
  const row = await c.env.DB.prepare(
    `INSERT INTO soda_ban_overrides (soda_id, hates_at_override)
     SELECT s.id, (SELECT COUNT(*) FROM soda_reports r WHERE r.soda_id = s.id AND r.verdict = 'hate')
     FROM sodas s WHERE s.id = ? AND s.is_active = 1 AND ${bannedSodaSql('s')}
     ON CONFLICT(soda_id) DO UPDATE SET
       hates_at_override = excluded.hates_at_override,
       created_at = datetime('now')
     RETURNING soda_id, hates_at_override`
  ).bind(id).first<{ soda_id: number; hates_at_override: number }>()
  if (!row) return c.json({ error: 'Not a banned drink', code: 'NOT_FOUND' }, 404)
  return c.json({ id: row.soda_id, hates_at_override: row.hates_at_override })
})

// Maps a barcode to a drink (source 'admin', overrides any earlier mapping) and resolves its open scans.
admin.post('/soda/barcodes', requireAdminSession, async (c) => {
  const body = await c.req.json<{ code?: unknown; soda_id?: unknown }>().catch((): { code?: unknown; soda_id?: unknown } => ({}))
  const code = normalizeBarcode(body.code)
  if (!code || !Number.isInteger(body.soda_id)) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO soda_barcodes (code, soda_id, source)
     SELECT ?, s.id, 'admin' FROM sodas s WHERE s.id = ? AND ${shownSodaSql('s')}
     ON CONFLICT(code) DO UPDATE SET soda_id = excluded.soda_id, source = 'admin'
     RETURNING soda_id`
  ).bind(code, body.soda_id).first<{ soda_id: number }>()
  if (!row) {
    if (await isSodaBanned(c.env.DB, body.soda_id as number)) {
      return c.json({ error: 'Soda is banned', code: 'SODA_BANNED' }, 409)
    }
    return c.json({ error: 'Soda not found', code: 'NOT_FOUND' }, 404)
  }

  await c.env.DB.prepare(
    `UPDATE soda_unknown_scans SET resolved_soda_id = ?, resolved_by = 'admin'
     WHERE code = ? AND resolved_soda_id IS NULL`
  ).bind(row.soda_id, code).run()
  return c.json({ code, soda_id: row.soda_id })
})

// Dismisses a code (e.g. not a soda): deletes its scans from the log and any voter-learned mapping,
// so a later scan is unknown again and logged. Seed and admin mappings stay.
admin.delete('/soda/unknown-scans/:code', requireAdminSession, async (c) => {
  const code = normalizeBarcode(c.req.param('code'))
  if (!code) return c.json({ error: 'Invalid barcode', code: 'BAD_REQUEST' }, 400)
  const [scans, mapping] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM soda_unknown_scans WHERE code = ?').bind(code),
    c.env.DB.prepare("DELETE FROM soda_barcodes WHERE code = ? AND source = 'voter'").bind(code),
  ])
  return c.json({ dismissed: scans.meta.changes ?? 0, voter_mapping_removed: (mapping.meta.changes ?? 0) > 0 })
})

export { admin as adminRouter }
