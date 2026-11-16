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
  /** Latest report per voter that is a like. */
  likes: number
  /** Latest report per voter that is a hate. */
  hates: number
  /** n: distinct reporters (likes + hates). */
  reporters: number
}

export type Posterior = { alpha: number; beta: number }

export const SODA_SCORE_PARAMS = {
  prior: { alpha: 1, beta: 1 },
  /** Right swipes per report-equivalent: 0.2 pseudo-counts each, so 5 swipes = 1 report. */
  swipeWeight: 0.2,
  /** Total right-swipe pseudo-counts are capped at this many. */
  swipeCap: 3,
  /** Swipe weight fades by swipeFade / (swipeFade + n) as reports arrive. */
  swipeFade: 3,
  /** Share of swipe pseudo-counts that go to alpha; the rest go to beta. */
  swipeLikeShare: 0.75,
} as const

/** κ = min(3, 0.2·R) · 3/(3+n). Right-swipe pseudo-count weight. */
export function swipeKappa(rightSwipes: number, reporters: number): number {
  const p = SODA_SCORE_PARAMS
  return Math.min(p.swipeCap, p.swipeWeight * rightSwipes) * (p.swipeFade / (p.swipeFade + reporters))
}

/**
 * Beta posterior on θ, the chance a drinker is glad the drink was bought.
 * Reports count 1 each. Right swipes add κ·0.75 to α and κ·0.25 to β.
 * Left swipes add nothing: "not a like" includes "haven't had it".
 */
export function posterior(drink: Pick<DrinkStats, 'right_swipes' | 'likes' | 'hates' | 'reporters'>): Posterior {
  const p = SODA_SCORE_PARAMS
  const kappa = swipeKappa(drink.right_swipes, drink.reporters)
  return {
    alpha: p.prior.alpha + drink.likes + kappa * p.swipeLikeShare,
    beta: p.prior.beta + drink.hates + kappa * (1 - p.swipeLikeShare),
  }
}

/** Posterior mean of θ. The primary ranking key. */
export function sodaScore(drink: Pick<DrinkStats, 'right_swipes' | 'likes' | 'hates' | 'reporters'>): number {
  const { alpha, beta } = posterior(drink)
  return alpha / (alpha + beta)
}

/** appeal = (R+1)/(R+L+2). Tiebreak only; the one place left swipes count. */
export function sodaAppeal(drink: Pick<DrinkStats, 'right_swipes' | 'left_swipes'>): number {
  return (drink.right_swipes + 1) / (drink.right_swipes + drink.left_swipes + 2)
}

/** True when the drink has any swipe or report. */
export function hasData(drink: Pick<DrinkStats, 'right_swipes' | 'left_swipes' | 'likes' | 'hates'>): boolean {
  return drink.right_swipes + drink.left_swipes + drink.likes + drink.hates > 0
}

export function sodaName(drink: Pick<DrinkStats, 'brand' | 'flavor'>): string {
  return `${drink.brand} ${drink.flavor}`
}

/** Ranking order: score desc, appeal desc, then name and id for a stable result. */
export function compareDrinks(a: DrinkStats, b: DrinkStats): number {
  return (sodaScore(b) - sodaScore(a))
    || (sodaAppeal(b) - sodaAppeal(a))
    || sodaName(a).localeCompare(sodaName(b))
    || a.id - b.id
}

export function rankDrinks<T extends DrinkStats>(drinks: T[]): T[] {
  return [...drinks].sort(compareDrinks)
}
