import type { Lunch, LunchRow } from './types'

export function lunchFromRow(row: LunchRow, baseUrl: string): Lunch {
  return {
    ...row,
    image_url: row.image_key ? `${baseUrl}/api/images/${row.image_key}` : null,
  }
}

export function validateAdminToken(request: Request, adminToken: string): boolean {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const token = auth.slice(7)
  // Constant-time comparison using TextEncoder
  if (token.length !== adminToken.length) return false
  const a = new TextEncoder().encode(token)
  const b = new TextEncoder().encode(adminToken)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
