export type Lunch = {
  id: number
  name: string
  description: string | null
  image_key: string | null
  image_url: string | null
  is_vegan: number
  rating: number
  wins: number
  losses: number
  ties: number
  created_at: string
  updated_at: string
}

export type LeaderboardLunch = Lunch & { rank: number }

const BASE = '/api'

export async function getMatchup(veganOnly = false): Promise<{ left: Lunch; right: Lunch } | null> {
  const res = await fetch(`${BASE}/matchup${veganOnly ? '?vegan=true' : ''}`)
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`Matchup fetch failed: ${res.status}`)
  return res.json()
}

export async function submitVote(
  leftId: number,
  rightId: number,
  result: 'left_win' | 'right_win' | 'tie'
): Promise<{ vote_id: number; next: { left: Lunch; right: Lunch } | null }> {
  const res = await fetch(`${BASE}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ left_lunch_id: leftId, right_lunch_id: rightId, result }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error ?? `Vote failed: ${res.status}`)
  }
  return res.json()
}

export async function getLeaderboard(veganOnly = false): Promise<LeaderboardLunch[]> {
  const res = await fetch(`${BASE}/lunches/leaderboard${veganOnly ? '?vegan=true' : ''}`)
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`)
  const data = await res.json()
  return data.lunches
}

export async function getLunches(): Promise<Lunch[]> {
  const res = await fetch(`${BASE}/lunches`)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json()
  return data.lunches
}

export async function getLunchesWithoutImages(): Promise<Lunch[]> {
  const res = await fetch(`${BASE}/lunches?missing_image=true`)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const data = await res.json()
  return data.lunches
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
  return data.lunch
}

export async function uploadImage(lunchId: number, file: File, token: string): Promise<void> {
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
}
