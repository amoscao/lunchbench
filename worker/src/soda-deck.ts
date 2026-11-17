import { hasOwnEvidence } from './soda-score'

/**
 * How hard the feed leans toward drinks people like, for drinks with their own evidence (a right
 * swipe or a report). Their weight is (odds(θ) / odds(m_type))^2: a liked drink is weighted well
 * above its category, a disliked one well below.
 */
export const DECK_BIAS_POWER = 2
/**
 * Untried drinks lean on their brand only (θ is the brand prior), and more softly: power 1. So an
 * untried flavor of a loved brand comes early, but not as early as drinks people actually liked,
 * and an untried flavor of a hated brand comes late without being buried.
 */
export const DECK_PRIOR_POWER = 1
/**
 * Weights are capped to this range. The extremes are 128x apart: a hated drink is rare near the
 * top of a feed but still turns up for some voters, so it can still collect right swipes.
 */
export const DECK_MIN_WEIGHT = 1 / 8
export const DECK_MAX_WEIGHT = 16

export type DeckDrink = {
  id: number
  /** Posterior mean θ from `scoreDrinks` (brand prior included; left swipes do not count). */
  score: number
  /** m_type from `scoreDrinks`: the shrunk mean of every drink of this drink's type. */
  type_mean: number
  right_swipes: number
  reporters: number
}

function odds(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p))
  return q / (1 - q)
}

/**
 * Sampling weight: θ's odds relative to its type mean's odds, so a drink is compared with its own
 * category. Reports on one brand move the type mean and that brand together, so they do not
 * reshuffle every other brand of the type. 1 for a drink exactly at its type mean.
 */
export function deckWeight(drink: DeckDrink): number {
  const power = hasOwnEvidence(drink) ? DECK_BIAS_POWER : DECK_PRIOR_POWER
  const weight = (odds(drink.score) / odds(drink.type_mean)) ** power
  return Math.min(DECK_MAX_WEIGHT, Math.max(DECK_MIN_WEIGHT, weight))
}

/**
 * A voter's swipe feed: every drink this voter has not swiped, in a weighted random order.
 *
 * Weighted sampling without replacement (Efraimidis–Spirakis): each drink gets the key u^(1/w),
 * with u a uniform draw in (0, 1) and w = `deckWeight(drink)`, and the feed is sorted by key,
 * largest first. Compared as ln(u)/w, which orders the same and does not underflow.
 *
 * u comes from `randomKey(id)`, which is stable per voter and drink. So the order is stable across
 * reloads while ratings do not change. Ratings include the voter's own: a right swipe or report
 * moves that drink's score and its type mean, which can reorder the rest of the feed a little.
 * Swiped drinks never come back. The feed is one continuous list; there are no fixed-size decks.
 */
export function buildFeed<T extends DeckDrink>(
  drinks: T[],
  swipedIds: ReadonlySet<number>,
  randomKey: (id: number) => number
): T[] {
  return drinks
    .filter((drink) => !swipedIds.has(drink.id))
    .map((drink) => {
      const u = Math.min(1 - 1e-12, Math.max(1e-12, randomKey(drink.id)))
      return { drink, key: Math.log(u) / deckWeight(drink) }
    })
    .sort((a, b) => b.key - a.key || a.drink.id - b.drink.id)
    .map((entry) => entry.drink)
}

/**
 * Random key stable per voter and drink. The seed "<session>:<id>" is hashed and then run through a
 * PRNG finalizer (`seeded(text)()`), because a raw string hash mixes the trailing id digits poorly
 * and would start most voters on the same few drinks.
 */
export function sessionTieKey(sessionKey: string, seeded: (text: string) => () => number): (id: number) => number {
  return (id) => seeded(`${sessionKey}:${id}`)()
}
