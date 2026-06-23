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
