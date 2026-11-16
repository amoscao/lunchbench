export type SodaType = 'soda' | 'seltzer'

export type DrinkStats = {
  id: number
  brand: string
  flavor: string
  type: SodaType
  image_key: string | null
  /** R: voters whose latest swipe is right. */
  right_swipes: number
  /** L: voters whose latest swipe is left. */
  left_swipes: number
  /** Voters whose report is a like. */
  likes: number
  /** Voters whose report is a hate. */
  hates: number
  /** n: distinct reporters (likes + hates). */
  reporters: number
}

/** Pseudo-counts from a drink's own swipes and reports. No prior. */
export type Evidence = { a: number; b: number }

export type Posterior = { alpha: number; beta: number }

export type ScoredDrink<T extends DrinkStats = DrinkStats> = T & {
  alpha: number
  beta: number
  /** Posterior mean of θ. The primary ranking key. */
  score: number
  /** (R+1)/(R+L+2). Tiebreak only. */
  appeal: number
  /** m_B(−i): the brand prior mean for this drink, leaving the drink itself out. */
  prior_mean: number
  /** m_type: the shrunk mean of every drink of this type. */
  type_mean: number
}

/** Shrinkage strength c for the type mean and the brand mean. */
export const SODA_MEAN_SHRINK = 4
/** Prior strength k: the brand prior counts as this many pseudo-reports. */
export const SODA_BRAND_PRIOR_STRENGTH = 2
/** Neutral mean the type mean shrinks toward. */
export const SODA_NEUTRAL_MEAN = 0.5

export const SODA_SCORE_PARAMS = {
  /** Right swipes per report-equivalent: 0.2 pseudo-counts each, so 5 swipes = 1 report. */
  swipeWeight: 0.2,
  /** Total right-swipe pseudo-counts are capped at this many. */
  swipeCap: 3,
  /** Swipe weight fades by swipeFade / (swipeFade + n) as reports arrive. */
  swipeFade: 3,
  /** Share of swipe pseudo-counts that go to a; the rest go to b. */
  swipeLikeShare: 0.75,
  /** c in m_type and m_B(−i). */
  meanShrink: SODA_MEAN_SHRINK,
  /** k in α0 = k·m_B(−i), β0 = k·(1 − m_B(−i)). */
  brandPriorStrength: SODA_BRAND_PRIOR_STRENGTH,
  neutralMean: SODA_NEUTRAL_MEAN,
} as const

/** κ = min(3, 0.2·R) · 3/(3+n). Right-swipe pseudo-count weight. */
export function swipeKappa(rightSwipes: number, reporters: number): number {
  const p = SODA_SCORE_PARAMS
  return Math.min(p.swipeCap, p.swipeWeight * rightSwipes) * (p.swipeFade / (p.swipeFade + reporters))
}

/**
 * A drink's own evidence. Each like adds 1 to a, each hate adds 1 to b.
 * Right swipes add κ·0.75 to a and κ·0.25 to b.
 * Left swipes add nothing: "not a like" includes "haven't had it".
 */
export function ownEvidence(drink: Pick<DrinkStats, 'right_swipes' | 'likes' | 'hates' | 'reporters'>): Evidence {
  const kappa = swipeKappa(drink.right_swipes, drink.reporters)
  return {
    a: drink.likes + kappa * SODA_SCORE_PARAMS.swipeLikeShare,
    b: drink.hates + kappa * (1 - SODA_SCORE_PARAMS.swipeLikeShare),
  }
}

/** Beta posterior from a prior mean of strength k plus the drink's own evidence. */
export function posteriorFrom(evidence: Evidence, priorMean: number): Posterior {
  const k = SODA_BRAND_PRIOR_STRENGTH
  return {
    alpha: k * priorMean + evidence.a,
    beta: k * (1 - priorMean) + evidence.b,
  }
}

/** appeal = (R+1)/(R+L+2). Tiebreak only; the one place left swipes count. */
export function sodaAppeal(drink: Pick<DrinkStats, 'right_swipes' | 'left_swipes'>): number {
  return (drink.right_swipes + 1) / (drink.right_swipes + drink.left_swipes + 2)
}

type Sums = { a: number; n: number }

function addTo(map: Map<string, Sums>, key: string, evidence: Evidence): void {
  const sums = map.get(key) ?? { a: 0, n: 0 }
  sums.a += evidence.a
  sums.n += evidence.a + evidence.b
  map.set(key, sums)
}

/**
 * Scores every drink with a hierarchical brand prior. Brands differ in quality, so a drink
 * borrows strength from its brand-mates:
 *
 * - m_type = (Σ_type a + c·0.5) / (Σ_type (a+b) + c)
 * - m_B(−i) = (Σ_{j∈B, j≠i} a_j + c·m_type) / (Σ_{j∈B, j≠i} (a_j+b_j) + c). Leaving drink i out avoids
 *   counting its own evidence twice. A single-drink brand gets exactly m_type.
 * - α = k·m_B(−i) + a_i, β = k·(1 − m_B(−i)) + b_i
 *
 * Brands are keyed by the catalog `brand` field as-is. The type mean uses drink i's type.
 */
export function scoreDrinks<T extends DrinkStats>(drinks: T[]): Array<ScoredDrink<T>> {
  const c = SODA_MEAN_SHRINK
  const evidence = drinks.map(ownEvidence)
  const byType = new Map<string, Sums>()
  const byBrand = new Map<string, Sums>()
  drinks.forEach((drink, i) => {
    addTo(byType, drink.type, evidence[i])
    addTo(byBrand, drink.brand, evidence[i])
  })

  return drinks.map((drink, i) => {
    const own = evidence[i]
    const type = byType.get(drink.type)!
    const typeMean = (type.a + c * SODA_NEUTRAL_MEAN) / (type.n + c)
    const brand = byBrand.get(drink.brand)!
    const priorMean = (brand.a - own.a + c * typeMean) / (brand.n - (own.a + own.b) + c)
    const { alpha, beta } = posteriorFrom(own, priorMean)
    return {
      ...drink,
      alpha,
      beta,
      score: alpha / (alpha + beta),
      appeal: sodaAppeal(drink),
      prior_mean: priorMean,
      type_mean: typeMean,
    }
  })
}

/** True when the drink has any swipe or report. */
export function hasData(drink: Pick<DrinkStats, 'right_swipes' | 'left_swipes' | 'likes' | 'hates'>): boolean {
  return drink.right_swipes + drink.left_swipes + drink.likes + drink.hates > 0
}

export function sodaName(drink: Pick<DrinkStats, 'brand' | 'flavor'>): string {
  return `${drink.brand} ${drink.flavor}`
}

/** Score desc, then appeal desc. 0 when both tie; callers pick the final tiebreak. */
export function compareByScore(a: ScoredDrink, b: ScoredDrink): number {
  return (b.score - a.score) || (b.appeal - a.appeal)
}

/** Public leaderboard order: score, appeal, then name and id for a stable result. */
export function compareDrinks(a: ScoredDrink, b: ScoredDrink): number {
  return compareByScore(a, b)
    || sodaName(a).localeCompare(sodaName(b))
    || a.id - b.id
}

/** Scores and sorts for the public leaderboard. */
export function rankDrinks<T extends DrinkStats>(drinks: T[]): Array<ScoredDrink<T>> {
  return scoreDrinks(drinks).sort(compareDrinks)
}
