export const NEW_LUNCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// D1 datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone suffix.
// Date.parse would read that as local time, so add the Z ourselves.
const D1_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/

export function parseUtcTimestamp(value: string | null | undefined): number {
  if (!value) return NaN
  const match = D1_DATETIME.exec(value.trim())
  return Date.parse(match ? `${match[1]}T${match[2]}Z` : value)
}

export function isNewLunch(lunch: { created_at?: string | null }, now: number = Date.now()): boolean {
  const created = parseUtcTimestamp(lunch.created_at)
  if (Number.isNaN(created)) return false
  return now - created < NEW_LUNCH_WINDOW_MS
}
