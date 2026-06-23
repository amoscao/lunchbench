export type LunchForMatchup = {
  id: number
  rating: number
  glicko_rd: number
  is_vegan?: number
  [key: string]: unknown
}

/**
 * Selects two distinct lunches for a voting matchup.
 * Weights anchor selection by uncertainty, then picks the closest-rated opponent.
 * Tries to avoid pairs that appeared in recentPairs, falling back only when needed.
 */
export function selectMatchup<T extends LunchForMatchup>(
  lunches: T[],
  recentPairs: [number, number][],
  excludedPairs: [number, number][] = []
): [T, T] | null {
  if (lunches.length < 2) return null

  const recentSet = new Set(recentPairs.map(([a, b]) => pairKey(a, b)))
  const excludedSet = new Set(excludedPairs.map(([a, b]) => pairKey(a, b)))
  const anchorPool = lunches.filter((lunch) =>
    lunches.some((other) =>
      other.id !== lunch.id &&
      sameVeganGroup(lunch, other) &&
      !excludedSet.has(pairKey(lunch.id, other.id)) &&
      !recentSet.has(pairKey(lunch.id, other.id))
    )
  )
  const fallbackAnchorPool = lunches.filter((lunch) =>
    lunches.some((other) =>
      other.id !== lunch.id &&
      sameVeganGroup(lunch, other) &&
      !excludedSet.has(pairKey(lunch.id, other.id))
    )
  )
  const availableAnchors = anchorPool.length > 0 ? anchorPool : fallbackAnchorPool
  if (availableAnchors.length === 0) return null

  const anchor = weightedByRd(availableAnchors)
  const sameGroup = lunches.filter((lunch) => sameVeganGroup(anchor, lunch))
  if (sameGroup.length < 2) return null

  const nonRecentOpponentPool = sameGroup.filter((lunch) =>
    lunch.id !== anchor.id &&
    !excludedSet.has(pairKey(anchor.id, lunch.id)) &&
    !recentSet.has(pairKey(anchor.id, lunch.id))
  )
  const opponentPool = nonRecentOpponentPool.length > 0
    ? nonRecentOpponentPool
    : sameGroup.filter((lunch) =>
      lunch.id !== anchor.id && !excludedSet.has(pairKey(anchor.id, lunch.id))
    )
  if (opponentPool.length === 0) return null

  const opponent = closestRated(anchor, opponentPool)
  const pair: [T, T] = [anchor, opponent]

  return Math.random() < 0.5 ? [pair[1], pair[0]] : pair
}

function weightedByRd<T extends LunchForMatchup>(lunches: T[]): T {
  const weights = lunches.map((lunch) => Math.max(0, lunch.glicko_rd))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return lunches[Math.floor(Math.random() * lunches.length)]

  const target = Math.random() * total
  let cumulative = 0
  for (let i = 0; i < lunches.length; i++) {
    cumulative += weights[i]
    if (target < cumulative) return lunches[i]
  }
  return lunches[lunches.length - 1]
}

function closestRated<T extends LunchForMatchup>(anchor: T, lunches: T[]): T {
  return [...lunches].sort((a, b) => {
    const ratingDiff = Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating)
    return ratingDiff || a.id - b.id
  })[0]
}

function pairKey(a: number, b: number): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}:${hi}`
}

function sameVeganGroup(a: LunchForMatchup, b: LunchForMatchup): boolean {
  return a.is_vegan === undefined || b.is_vegan === undefined || a.is_vegan === b.is_vegan
}
