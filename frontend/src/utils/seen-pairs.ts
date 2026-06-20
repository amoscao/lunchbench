const KEY = 'lb_seen_pairs'
const MAX = 200

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function hasSeen(leftId: number, rightId: number): boolean {
  return load().has(pairKey(leftId, rightId))
}

export function markSeen(leftId: number, rightId: number): void {
  const set = load()
  set.add(pairKey(leftId, rightId))
  save(set.size >= MAX ? new Set() : set)
}

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function save(set: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]))
  } catch { /* storage full */ }
}
