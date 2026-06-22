import type { Lunch, LunchRow } from './types'

type SessionRole = 'admin' | 'lunch'

type AdminSessionRow = {
  token: string
  role: SessionRole
  expires_at: string
}

export function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length

  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }

  return diff === 0
}


export function lunchFromRow(row: LunchRow, baseUrl: string): Lunch {
  return {
    ...row,
    image_url: row.image_key ? `${baseUrl}/api/images/${row.image_key}` : null,
    glicko_rd: row.glicko_rd,
    glicko_volatility: row.glicko_volatility,
    conservative_rating: row.conservative_rating,
  }
}

export async function findMatchingAdminSession(
  db: D1Database,
  token: string
): Promise<AdminSessionRow | null> {
  const sessions = await db.prepare(
    'SELECT token, role, expires_at FROM admin_sessions'
  ).all<AdminSessionRow>()

  let matchedSession: AdminSessionRow | null = null

  for (const session of sessions.results) {
    if (constantTimeEquals(token, session.token)) {
      matchedSession = session
    }
  }

  return matchedSession
}

export async function validateAdminSession(
  request: Request,
  db: D1Database,
  requiredRole?: SessionRole
): Promise<boolean> {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const token = auth.slice(7)

  const session = await findMatchingAdminSession(db, token)

  if (!session) return false
  if (new Date(session.expires_at) <= new Date()) return false

  if (requiredRole === 'admin') return session.role === 'admin'
  if (requiredRole === 'lunch') return session.role === 'admin' || session.role === 'lunch'

  return true
}
