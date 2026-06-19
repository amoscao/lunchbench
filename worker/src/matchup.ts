export type LunchForMatchup = {
  id: number
  [key: string]: unknown
}

/**
 * Selects two distinct lunches for a voting matchup.
 * Tries to avoid pairs that appeared in recentPairs (list of [idA, idB] tuples).
 * Falls back to any random pair if all are recent.
 */
export function selectMatchup<T extends LunchForMatchup>(
  lunches: T[],
  recentPairs: [number, number][]
): [T, T] | null {
  if (lunches.length < 2) return null

  const recentSet = new Set(recentPairs.map(([a, b]) => pairKey(a, b)))

  // Shuffle a copy
  const shuffled = [...lunches].sort(() => Math.random() - 0.5)

  // Try to find a pair not in recentPairs
  for (let i = 0; i < shuffled.length; i++) {
    for (let j = i + 1; j < shuffled.length; j++) {
      const a = shuffled[i]
      const b = shuffled[j]
      if (!recentSet.has(pairKey(a.id, b.id))) {
        return [a, b]
      }
    }
  }

  // All pairs are recent - fall back to first shuffled pair
  return [shuffled[0], shuffled[1]]
}

function pairKey(a: number, b: number): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}:${hi}`
}
