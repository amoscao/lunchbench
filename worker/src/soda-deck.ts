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

/**
 * A voter's swipe feed: every drink this voter has not swiped, least evidence first.
 * Ties are ordered by a per-drink key (`tieKey(id)`), not by shuffling the remaining list, so a
 * drink's place relative to the others never changes as the voter swipes or reloads.
 * Swiped drinks never come back. The feed is one continuous list; there are no fixed-size decks.
 */
export function buildFeed<T extends DeckDrink>(
  drinks: T[],
  swipedIds: ReadonlySet<number>,
  tieKey: (id: number) => number
): T[] {
  return drinks
    .filter((drink) => !swipedIds.has(drink.id))
    .map((drink) => ({ drink, evidence: deckEvidence(drink), tie: tieKey(drink.id) }))
    .sort((a, b) => a.evidence - b.evidence || a.tie - b.tie || a.drink.id - b.drink.id)
    .map((entry) => entry.drink)
}

/** Tie key stable per voter and drink: hash of "<session>:<id>". */
export function sessionTieKey(sessionKey: string, hash: (text: string) => number): (id: number) => number {
  return (id) => hash(`${sessionKey}:${id}`)
}
