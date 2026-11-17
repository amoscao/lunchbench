/**
 * How hard the feed leans toward drinks people like. A drink's weight is its posterior odds,
 * θ/(1−θ), raised to this power. With 2, a drink scored 0.8 is weighted 16x an unrated (0.5) drink,
 * and a drink scored 0.3 about 0.18x, so voters mostly see promising drinks and rarely wade
 * through ones the office already dislikes. Every drink still has a chance at any position.
 */
export const DECK_BIAS_POWER = 2

/** Scores are clamped to this range before the odds, so no weight is 0 or infinite. */
const MIN_SCORE = 0.02
const MAX_SCORE = 0.98

export type DeckDrink = {
  id: number
  /** Posterior mean θ from `scoreDrinks` (brand prior included; left swipes do not count). */
  score: number
}

/** Sampling weight for a drink with posterior mean `score`. 1 at 0.5. */
export function deckWeight(score: number): number {
  const p = Math.min(MAX_SCORE, Math.max(MIN_SCORE, score))
  return (p / (1 - p)) ** DECK_BIAS_POWER
}

/**
 * A voter's swipe feed: every drink this voter has not swiped, in a weighted random order.
 *
 * Weighted sampling without replacement (Efraimidis–Spirakis): each drink gets the key u^(1/w),
 * with u a uniform draw in (0, 1) and w = `deckWeight(score)`, and the feed is sorted by key,
 * largest first. Compared as ln(u)/w, which orders the same and does not underflow.
 *
 * u comes from `randomKey(id)`, which is stable per voter and drink. So a drink keeps its place
 * relative to the others across swipes and reloads, as long as scores do not change.
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
      return { drink, key: Math.log(u) / deckWeight(drink.score) }
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
