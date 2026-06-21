import type { Lunch, LunchRow } from './types'

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
  db: D1Database
): Promise<boolean> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const token = auth.slice(7)

  const session = await db.prepare(
    'SELECT expires_at FROM admin_sessions WHERE token = ?'
  ).bind(token).first<{ expires_at: string }>()

  if (!session) return false
  return new Date(session.expires_at) > new Date()
}
