export const DECK_SIZE = 20
/** One report counts as much evidence as this many swipes when ordering the deck. */
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
 * Orders a voter's deck.
 * Drinks this voter has not swiped come first, least evidence first; ties are shuffled.
 * Swiped drinks only follow once the unswiped pool is used up, oldest swipe first.
 */
export function buildDeck<T extends DeckDrink>(
  drinks: T[],
  voterSwipedAt: Map<number, string>,
  size = DECK_SIZE,
  rng: () => number = Math.random
): T[] {
  const unswiped = shuffle(drinks.filter((drink) => !voterSwipedAt.has(drink.id)), rng)
    .sort((a, b) => deckEvidence(a) - deckEvidence(b))
  const swiped = drinks
    .filter((drink) => voterSwipedAt.has(drink.id))
    .sort((a, b) =>
      (voterSwipedAt.get(a.id) ?? '').localeCompare(voterSwipedAt.get(b.id) ?? '') || a.id - b.id
    )
  return [...unswiped, ...swiped].slice(0, size)
}
