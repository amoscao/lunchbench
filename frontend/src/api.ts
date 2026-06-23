import { getSessionId } from './utils/session-id'

export type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
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
    throw new Error((err as any).error ?? `Create failed: ${res.status}`)
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
    throw new Error((err as any).error ?? `Upload failed: ${res.status}`)
  }
  const data = await res.json() as ImageUploadResult
  return {
    ...data,
    image_url: resolveImageUrl(data.image_url) ?? data.image_url,
  }
}

export async function verifyAdminToken(password: string): Promise<string> {
  const res = await fetch(`${BASE}/admin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? `Admin verification failed: ${res.status}`)
  }
  const body = await res.json() as { token: string }
  return body.token
}
