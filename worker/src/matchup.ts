export type LunchForMatchup = {
  id: number
  rating: number
  glicko_rd: number
  is_vegan?: number
  presentation_count?: number
  [key: string]: unknown
}

const MAX_RD = 350
const EXPLOITATION_WEIGHT = 0.5
const UNCERTAINTY_WEIGHT = 0.25
const FRESHNESS_WEIGHT = 0.2
const JITTER_WEIGHT = 0.05

/**
 * Selects two distinct lunches for a voting matchup.
 * Weights anchor selection by uncertainty, then samples an opponent by pair score.
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

  const opponent = weightedByOpponentScore(anchor, opponentPool)
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

function weightedByOpponentScore<T extends LunchForMatchup>(anchor: T, lunches: T[]): T {
  const scored = lunches.map((lunch) => ({
    lunch,
    score: opponentScore(anchor, lunch),
  }))
  const total = scored.reduce((sum, item) => sum + item.score, 0)
  if (total <= 0) return lunches[Math.floor(Math.random() * lunches.length)]

  const target = Math.random() * total
  let cumulative = 0
  for (const item of scored) {
    cumulative += item.score
    if (target < cumulative) return item.lunch
  }
  return scored[scored.length - 1].lunch
}

function opponentScore(anchor: LunchForMatchup, opponent: LunchForMatchup): number {
  const exploitation = 1 / (1 + Math.abs(anchor.rating - opponent.rating))
  const uncertainty = clamp01(opponent.glicko_rd / MAX_RD)
  const freshness = 1 / (1 + (opponent.presentation_count ?? 0))
  const jitter = Math.random()

  return (
    EXPLOITATION_WEIGHT * exploitation +
    UNCERTAINTY_WEIGHT * uncertainty +
    FRESHNESS_WEIGHT * freshness +
    JITTER_WEIGHT * jitter
  )
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function pairKey(a: number, b: number): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}:${hi}`
}

function sameVeganGroup(a: LunchForMatchup, b: LunchForMatchup): boolean {
  return a.is_vegan === undefined || b.is_vegan === undefined || a.is_vegan === b.is_vegan
}
