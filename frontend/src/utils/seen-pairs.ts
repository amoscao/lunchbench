import type { MatchupResult } from '../api'

const KEY = 'lb_seen_pairs'
const MAX = 2000

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function hasSeen(leftId: number, rightId: number): boolean {
  return load().includes(pairKey(leftId, rightId))
}

export function markSeen(leftId: number, rightId: number): void {
  const key = pairKey(leftId, rightId)
  const next = load().filter(item => item !== key)
  next.push(key)
  save(next.slice(-MAX))
}

// Returns the first matchup unless this browser already rendered that pair. Then it
// fetches one fresh matchup and uses it. Only one retry, so an exhausted pool cannot
// loop. If the retry fails or returns no pair, the original pair is used.
export async function fetchUnseenMatchup(
  fetchMatchup: () => Promise<MatchupResult>
): Promise<MatchupResult> {
  const first = await fetchMatchup()
  if (first?.status !== 'ok' || !hasSeen(first.left.id, first.right.id)) return first
  try {
    const fresh = await fetchMatchup()
    return fresh?.status === 'ok' ? fresh : first
  } catch {
    return first
  }
}

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function save(items: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch { /* storage full */ }
}
