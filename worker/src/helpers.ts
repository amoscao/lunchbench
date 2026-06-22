import type { Lunch, LunchRow } from './types'

type SessionRole = 'admin' | 'lunch'

export function lunchFromRow(row: LunchRow, baseUrl: string): Lunch {
  return {
    ...row,
    image_url: row.image_key ? `${baseUrl}/api/images/${row.image_key}` : null,
    glicko_rd: row.glicko_rd,
    glicko_volatility: row.glicko_volatility,
    conservative_rating: row.conservative_rating,
  }
}

export async function validateAdminSession(
  request: Request,
  db: D1Database,
  requiredRole?: SessionRole
): Promise<boolean> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const token = auth.slice(7)

  const session = await db.prepare(
    'SELECT role, expires_at FROM admin_sessions WHERE token = ?'
  ).bind(token).first<{ role: SessionRole; expires_at: string }>()

  if (!session) return false
  if (new Date(session.expires_at) <= new Date()) return false

  if (requiredRole === 'admin') return session.role === 'admin'
  if (requiredRole === 'lunch') return session.role === 'admin' || session.role === 'lunch'

  return true
}
