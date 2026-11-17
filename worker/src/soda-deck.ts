import { ownEvidence } from './soda-score'

/**
 * How hard a drink's own evidence moves its feed weight: the own factor is ((1 + a)/(1 + b))^2,
 * with (a, b) its own like and hate pseudo-counts (reports, plus right swipes as weak likes).
 * It is 1 with no evidence, rises with every like or right swipe and falls with every hate.
 */
export const DECK_BIAS_POWER = 2
/**
 * Weights are capped to this range. The extremes are 128x apart: a hated drink is rare near the
 * top of a feed but still turns up for some voters, so it can still collect right swipes.
 */
export const DECK_MIN_WEIGHT = 1 / 8
export const DECK_MAX_WEIGHT = 16

export type DeckDrink = {
  id: number
  /** m_B(−i) from `scoreDrinks`: the drink's brand prior mean, leaving the drink itself out. */
  prior_mean: number
  /** m_type from `scoreDrinks`: the shrunk mean of every drink of this drink's type. */
  type_mean: number
  right_swipes: number
  likes: number
  hates: number
  reporters: number
}

function odds(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p))
  return q / (1 - q)
}

/**
 * Sampling weight = brand factor × own factor, capped to [DECK_MIN_WEIGHT, DECK_MAX_WEIGHT].
 *
 * - Brand factor: odds(m_B(−i)) / odds(m_type). A drink is compared with its own category, so
 *   reports on one brand do not reshuffle every other brand or the other type. 1 for a brand with
 *   no data. An untried flavor of a loved brand comes early; one of a hated brand comes late.
 * - Own factor: ((1 + a)/(1 + b))^DECK_BIAS_POWER from the drink's own evidence (`ownEvidence`).
 *   Raw counts, not the posterior: the posterior pulls toward the swipe mean (0.75), so in an
 *   office that mostly reports likes, right swipes would lower θ and push a drink later. Raw
 *   counts make every right swipe and like raise the weight and every hate lower it.
 */
export function deckWeight(drink: DeckDrink): number {
  const brand = odds(drink.prior_mean) / odds(drink.type_mean)
  const { a, b } = ownEvidence(drink)
  const own = ((1 + a) / (1 + b)) ** DECK_BIAS_POWER
  return Math.min(DECK_MAX_WEIGHT, Math.max(DECK_MIN_WEIGHT, brand * own))
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
