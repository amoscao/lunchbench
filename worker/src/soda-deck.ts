/** One report counts as much evidence as this many swipes when ordering the feed. */
export const DECK_REPORT_WEIGHT = 5

export type DeckDrink = {
  id: number
  right_swipes: number
  left_swipes: number
  reporters: number
}

/** Evidence on a drink across all voters. Lower means more uncertain. */
export function deckEvidence(drink: DeckDrink): number {
  return drink.right_swipes + drink.left_swipes + DECK_REPORT_WEIGHT * drink.reporters
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A voter's swipe feed: every drink this voter has not swiped, least evidence first, ties shuffled.
 * Swiped drinks never come back. The feed is one continuous list; there are no fixed-size decks.
 */
export function buildFeed<T extends DeckDrink>(
  drinks: T[],
  swipedIds: ReadonlySet<number>,
  rng: () => number = Math.random
): T[] {
  const unswiped = [...drinks].filter((drink) => !swipedIds.has(drink.id)).sort((a, b) => a.id - b.id)
  return shuffle(unswiped, rng).sort((a, b) => deckEvidence(a) - deckEvidence(b))
}
