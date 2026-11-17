import { getSessionId } from './utils/session-id'

export type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
  is_legacy: number
  rank: number
  rating: number
  conservative_rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

export type LeaderboardLunch = Lunch & {
  rank: number
  confidence: number
  consistency: number | null
  consistency_band: string | null
  glicko_rd: number
  conservative_rating: number
}

export type LeaderboardPage = {
  lunches: LeaderboardLunch[]
}

export type LunchDetail = Lunch & {
  glicko_rd: number
  glicko_volatility: number
  conservative_rating: number
  confidence: number
  consistency: number | null
  consistency_band: string | null
  win_rate: number
  momentum: number
}

export type VoteResult = {
  rating: number
  conservative_rating: number
  rank: number
}

export type ImageUploadResult = {
  image_key: string
  image_url: string
}

export type ProjectedResult = {
  rating: number
  conservative_rating: number
  rank: number
}

export type ProjectedOutcomes = {
  left_win: { left: ProjectedResult; right: ProjectedResult }
  right_win: { left: ProjectedResult; right: ProjectedResult }
  tie: { left: ProjectedResult; right: ProjectedResult }
}

export type Matchup = {
  status: 'ok'
  matchup_token: string
  left: Lunch
  right: Lunch
  projected: ProjectedOutcomes
}

export type MatchupExhausted = {
  status: 'exhausted'
}

export type MatchupResult = Matchup | MatchupExhausted | null

const BASE = '/api'

export class ApiError extends Error {
  /** `code` is the API's error code (e.g. 'SODA_BANNED') when the response carried one. */
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Reads the `code` field of a JSON error response, if any. */
async function errorCode(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null) as { code?: unknown } | null
  return typeof body?.code === 'string' ? body.code : undefined
}

/** True when the drink was auto-banned (#298) after this page loaded it. */
export function isSodaBannedError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.code === 'SODA_BANNED'
}

function resolveImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null
  return new URL(imageUrl, window.location.origin).toString()
}

function normalizeLunch<T extends { image_url: string | null }>(lunch: T): T {
  return {
    ...lunch,
    image_url: resolveImageUrl(lunch.image_url),
  }
}

export async function getMatchup(veganOnly = false): Promise<MatchupResult> {
  const res = await fetch(`${BASE}/matchup${veganOnly ? '?vegan=true' : ''}`, {
    headers: { 'X-Lunchbench-Session': getSessionId() },
  })
  if (res.status === 204) return null
  if (res.status === 429) throw new Error('rate_limited')
  if (!res.ok) throw new Error(`Matchup fetch failed: ${res.status}`)
  const data = await res.json() as Matchup | MatchupExhausted
  if (data.status === 'exhausted') return data
  return {
    ...data,
    left: normalizeLunch(data.left),
    right: normalizeLunch(data.right),
  }
}

export async function acknowledgeMatchupSeen(token: string): Promise<void> {
  const res = await fetch(`${BASE}/matchup/seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(`Matchup seen ack failed: ${res.status}`)
}

export async function submitVote(
  leftId: number,
  rightId: number,
  result: 'left_win' | 'right_win' | 'tie'
): Promise<{
  vote_id: number
  left_result: VoteResult
  right_result: VoteResult
}> {
  const res = await fetch(`${BASE}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ left_lunch_id: leftId, right_lunch_id: rightId, result }),
  })
  if (res.status === 429) throw new Error('rate_limited')
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? `Vote failed: ${res.status}`)
  }
  const data = await res.json() as {
    vote_id: number
    left_result: VoteResult
    right_result: VoteResult
  }
  return data
}

export async function getLeaderboard(veganOnly = false): Promise<LeaderboardPage> {
  const params = new URLSearchParams()
  if (veganOnly) params.set('vegan', 'true')
  const res = await fetch(`${BASE}/lunches/leaderboard?${params}`)
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`)
  const data = await res.json() as LeaderboardPage
  return { lunches: data.lunches.map(normalizeLunch) }
}

export async function getLunches(): Promise<Lunch[]> {
  const res = await fetch(`${BASE}/lunches`)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json()
  return data.lunches.map(normalizeLunch)
}

export async function getLunchesWithoutImages(): Promise<Lunch[]> {
  const res = await fetch(`${BASE}/lunches?missing_image=true`)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json()
  return data.lunches.map(normalizeLunch)
}

export async function getLunch(id: number): Promise<LunchDetail> {
  const res = await fetch(`${BASE}/lunches/${id}`)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json() as LunchDetail
  return normalizeLunch(data)
}

export async function createLunch(
  name: string,
  token: string,
  description?: string | null,
  is_vegan = false
): Promise<Lunch> {
  const res = await fetch(`${BASE}/lunches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, description, is_vegan }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError((err as any).error ?? `Create failed: ${res.status}`, res.status)
  }
  const data = await res.json()
  return normalizeLunch(data.lunch)
}

export async function uploadImage(lunchId: number, file: File, token: string): Promise<ImageUploadResult> {
  const form = new FormData()
  form.append('image', file)
  const res = await fetch(`${BASE}/lunches/${lunchId}/image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError((err as any).error ?? `Upload failed: ${res.status}`, res.status)
  }
  const data = await res.json() as ImageUploadResult
  return {
    ...data,
    image_url: resolveImageUrl(data.image_url) ?? data.image_url,
  }
}

export type SessionRole = 'admin' | 'lunch' | 'purchaser'

/**
 * Logs in and returns the token only if the session role is one of `allowed`.
 * Any other role is revoked at once and reported as an invalid password,
 * so a purchaser password never works as a lunch login and vice versa.
 */
export async function verifySessionForRoles(password: string, allowed: SessionRole[]): Promise<string> {
  const { token, role } = await verifySession(password)
  if (!allowed.includes(role)) {
    await revokeSession(token).catch(() => undefined)
    throw new Error('Invalid password')
  }
  return token
}

export async function verifySession(password: string): Promise<{ token: string; role: SessionRole }> {
  const res = await fetch(`${BASE}/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? `Admin verification failed: ${res.status}`)
  }
  return await res.json() as { token: string; role: SessionRole }
}

export type SodaType = 'soda' | 'seltzer'

export type Soda = {
  id: number
  brand: string
  flavor: string
  name: string
  type: SodaType
  image_url: string | null
}

export type SodaLeaderboardRow = Soda & {
  rank: number
  right_swipes: number
  left_swipes: number
  likes: number
  hates: number
  reporters: number
  score: number
  has_data: boolean
}

export type SodaOrderItem = {
  rank: number
  slot: 'top' | 'trial'
  soda_id: number
  brand: string
  flavor: string
  name: string
  type: SodaType
  image_url: string | null
  right_swipes: number
  left_swipes: number
  has_data: boolean
}

export type SodaOrder = {
  week_start: string
  generated_at: string
  items: SodaOrderItem[]
}

export async function getSodaCatalog(): Promise<Soda[]> {
  const res = await fetch(`${BASE}/soda/catalog`)
  if (!res.ok) throw new Error(`Soda catalog fetch failed: ${res.status}`)
  const data = await res.json() as { sodas: Soda[] }
  return data.sodas.map(normalizeLunch)
}

export async function getSodaDeck(): Promise<Soda[]> {
  const res = await fetch(`${BASE}/soda/deck`, {
    headers: { 'X-Lunchbench-Session': getSessionId() },
  })
  if (!res.ok) throw new Error(`Soda deck fetch failed: ${res.status}`)
  const data = await res.json() as { sodas: Soda[] }
  return data.sodas.map(normalizeLunch)
}

export async function submitSodaSwipe(sodaId: number, direction: 'right' | 'left'): Promise<void> {
  const res = await fetch(`${BASE}/soda/swipes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': getSessionId() },
    body: JSON.stringify({ soda_id: sodaId, direction }),
  })
  if (!res.ok) throw new ApiError(`Swipe failed: ${res.status}`, res.status, await errorCode(res))
}

/**
 * `barcode` is the unknown code this voter scanned before picking the drink manually.
 * The response then says which drink that code maps to now (null when it stays unmapped).
 */
export async function submitSodaReport(
  sodaId: number,
  verdict: 'like' | 'hate',
  barcode?: string
): Promise<{ barcode_soda_id?: number | null }> {
  const res = await fetch(`${BASE}/soda/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': getSessionId() },
    body: JSON.stringify(barcode ? { soda_id: sodaId, verdict, barcode } : { soda_id: sodaId, verdict }),
  })
  if (!res.ok) throw new ApiError(`Report failed: ${res.status}`, res.status, await errorCode(res))
  return await res.json().catch(() => ({})) as { barcode_soda_id?: number | null }
}

export async function getSodaBarcodes(): Promise<{ code: string; soda_id: number }[]> {
  const res = await fetch(`${BASE}/soda/barcodes`)
  if (!res.ok) throw new Error(`Soda barcodes fetch failed: ${res.status}`)
  const data = await res.json() as { barcodes: { code: string; soda_id: number }[] }
  return data.barcodes
}

/** Logs a scanned code that matched no drink. Only the decoded string and its symbology are sent. */
export async function logUnknownScan(barcode: string, format: string): Promise<void> {
  const res = await fetch(`${BASE}/soda/unknown-scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lunchbench-Session': getSessionId() },
    body: JSON.stringify({ barcode, format }),
  })
  if (!res.ok) throw new ApiError(`Unknown scan log failed: ${res.status}`, res.status)
}

export async function getSodaLeaderboard(): Promise<SodaLeaderboardRow[]> {
  const res = await fetch(`${BASE}/soda/leaderboard`)
  if (!res.ok) throw new Error(`Soda leaderboard fetch failed: ${res.status}`)
  const data = await res.json() as { sodas: SodaLeaderboardRow[] }
  return data.sodas.map(normalizeLunch)
}

export async function getSodaOrder(token: string): Promise<SodaOrder> {
  const res = await fetch(`${BASE}/soda/order/latest`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new ApiError(`Order fetch failed: ${res.status}`, res.status)
  const data = await res.json() as SodaOrder
  return { ...data, items: data.items.map(normalizeLunch) }
}

export async function revokeSession(token: string): Promise<void> {
  await fetch(`${BASE}/admin/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}
