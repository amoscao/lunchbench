import { compareByScore, hasData, hasOwnEvidence, ownEvidence, SODA_SCORE_PARAMS, scoreDrinks, type DrinkStats, type ScoredDrink, type SodaType } from './soda-score'

export type OrderSlot = 'top' | 'trial'

export type OrderItem = {
  rank: number
  slot: OrderSlot
  soda_id: number
  brand: string
  flavor: string
  type: SodaType
  image_key: string | null
  right_swipes: number
  left_swipes: number
  has_data: boolean
}

/** Upper limit on the own-evidence bar for favorites. */
export const OWN_EVIDENCE_BAR_CAP = 0.5

export const ORDER_PARAMS = {
  /** Favorites per type: 4 sodas, then 4 seltzers. */
  topPerType: 4,
  /** Trials per type: exactly one soda trial and one seltzer trial. */
  trialsPerType: 1,
  /** Trial-eligible when the drink has fewer distinct reporters than this. */
  trialMaxReporters: 3,
  /** Weeks of past trials to avoid repeating. */
  trialCooldownWeeks: 2,
  ownEvidenceBarCap: OWN_EVIDENCE_BAR_CAP,
} as const

export type OrderOptions = {
  /** Seed for Thompson sampling. The week start, so a rerun is reproducible. */
  seed: string
  /** Drinks trialed in the cooldown window. Avoided when other eligible drinks exist. */
  recentTrialIds?: Iterable<number>
}

/** 32-bit FNV-1a hash. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: small deterministic PRNG returning [0, 1). */
export function seededRandom(seed: string): () => number {
  let state = hashSeed(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleNormal(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Marsaglia–Tsang gamma sampler. */
export function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = Math.max(rng(), Number.MIN_VALUE)
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = sampleNormal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(Math.max(u, Number.MIN_VALUE)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng)
  const y = sampleGamma(beta, rng)
  return x / (x + y)
}

/** Own evidence mean a/(a+b), or null when the drink has no own evidence (R + n = 0). */
function ownMean(drink: ScoredDrink): number | null {
  if (!hasOwnEvidence(drink)) return null
  const own = ownEvidence(drink)
  return own.a / (own.a + own.b)
}

/**
 * Bar for a drink's OWN evidence mean: min(type_mean, 0.5). Capped at 0.5 because people tend to
 * report what they liked, which can push the type mean above 0.75, the own mean of a swipe-only
 * drink. Without the cap, every swipe-only drink would count as known-bad.
 */
function ownBar(drink: ScoredDrink): number {
  return Math.min(drink.type_mean, OWN_EVIDENCE_BAR_CAP)
}

/**
 * A backed favorite has own evidence (R + n > 0), a posterior mean at least the type mean, and an
 * own evidence mean a/(a+b) at least min(type_mean, 0.5). The own check stops a strong brand from
 * carrying a drink whose only evidence is a hate into a top slot. The posterior bar is the type mean,
 * not the drink's brand prior: a favorite should be a good drink of its type, and a strong brand
 * should not hold its own good drinks to a higher bar.
 */
function isBacked(drink: ScoredDrink): boolean {
  const own = ownMean(drink)
  return own !== null && own >= ownBar(drink) && drink.score >= drink.type_mean
}

/** Own evidence says net-negative: own mean below min(type_mean, 0.5). */
function isKnownBad(drink: ScoredDrink): boolean {
  const own = ownMean(drink)
  return own !== null && own < ownBar(drink)
}

/**
 * Picks favorites for one type (the top slots). Fills in tiers, each in rank order:
 * 1. backed drinks;
 * 2. the rest, except known-bad drinks: untried drinks, and drinks with decent own evidence whose
 *    posterior sits below the type mean;
 * 3. known-bad drinks, whose own evidence mean is below min(type_mean, 0.5).
 */
function pickFavorites(ranked: ScoredDrink[], type: SodaType, count: number): ScoredDrink[] {
  const ofType = ranked.filter((drink) => drink.type === type)
  return [
    ...ofType.filter(isBacked),
    ...ofType.filter((drink) => !isBacked(drink) && !isKnownBad(drink)),
    ...ofType.filter(isKnownBad),
  ].slice(0, count)
}

function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Ranks by score and appeal. Exact ties are broken by a week-seeded shuffle, not by name,
 * so a fresh catalog (everything tied at the prior) does not always buy the same alphabetical drinks.
 */
export function rankForWeek(drinks: DrinkStats[], seed: string): ScoredDrink[] {
  const byId = scoreDrinks(drinks).sort((a, b) => a.id - b.id)
  return seededShuffle(byId, seededRandom(`${seed}:ties`)).sort(compareByScore)
}

/** Thompson-samples θ̃ for each candidate and returns them ordered by draw, best first. */
function thompsonOrder(candidates: ScoredDrink[], rng: () => number): ScoredDrink[] {
  return [...candidates]
    .sort((a, b) => a.id - b.id)
    .map((drink) => ({ drink, draw: sampleBeta(drink.alpha, drink.beta, rng) }))
    .sort((a, b) => b.draw - a.draw || a.drink.id - b.drink.id)
    .map(({ drink }) => drink)
}

/**
 * One type's trial: Thompson-sampled from that type's trial-eligible drinks (n < 3, not a favorite),
 * avoiding recent trials when possible. With no eligible drink, falls back to the next-best drink
 * of that type that is not already listed. Returns null only when the type has nothing left.
 */
function pickTrial(
  ranked: ScoredDrink[],
  type: SodaType,
  listed: Set<number>,
  recent: Set<number>,
  rng: () => number
): ScoredDrink | null {
  const unlisted = ranked.filter((drink) => drink.type === type && !listed.has(drink.id))
  const eligible = unlisted.filter((drink) => drink.reporters < ORDER_PARAMS.trialMaxReporters)
  const fresh = thompsonOrder(eligible.filter((drink) => !recent.has(drink.id)), rng)
  const repeats = thompsonOrder(eligible.filter((drink) => recent.has(drink.id)), rng)
  return fresh[0] ?? repeats[0] ?? unlisted[0] ?? null
}

/**
 * Builds the weekly order list (10 rows when the catalog allows):
 * top 4 sodas, top 4 seltzers, then one soda trial and one seltzer trial.
 * Trials are Thompson-sampled per type from low-data drinks (n < 3) that are not favorites,
 * avoiding the previous weeks' trials when possible.
 */
export function buildOrderList(drinks: DrinkStats[], options: OrderOptions): OrderItem[] {
  const p = ORDER_PARAMS
  const ranked = rankForWeek(drinks, options.seed)
  const sodas = pickFavorites(ranked, 'soda', p.topPerType)
  const seltzers = pickFavorites(ranked, 'seltzer', p.topPerType)
  const listed = new Set([...sodas, ...seltzers].map((drink) => drink.id))

  const recent = new Set(options.recentTrialIds ?? [])
  const rng = seededRandom(options.seed)
  const trials: ScoredDrink[] = []
  for (const type of ['soda', 'seltzer'] as const) {
    for (let i = 0; i < p.trialsPerType; i++) {
      const trial = pickTrial(ranked, type, listed, recent, rng)
      if (!trial) break
      trials.push(trial)
      listed.add(trial.id)
    }
  }

  const slots: Array<[OrderSlot, DrinkStats]> = [
    ...sodas.map((drink): [OrderSlot, DrinkStats] => ['top', drink]),
    ...seltzers.map((drink): [OrderSlot, DrinkStats] => ['top', drink]),
    ...trials.map((drink): [OrderSlot, DrinkStats] => ['trial', drink]),
  ]

  return slots.map(([slot, drink], index) => ({
    rank: index + 1,
    slot,
    soda_id: drink.id,
    brand: drink.brand,
    flavor: drink.flavor,
    type: drink.type,
    image_key: drink.image_key,
    right_swipes: drink.right_swipes,
    left_swipes: drink.left_swipes,
    has_data: hasData(drink),
  }))
}

export function orderParams(seed: string, recentTrialIds: number[]): Record<string, unknown> {
  return {
    model: 'beta-brand-prior-v4',
    seed,
    score: SODA_SCORE_PARAMS,
    order: ORDER_PARAMS,
    recent_trial_ids: recentTrialIds,
  }
}

const WEEKDAY_OFFSET: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
}

/** Monday (America/New_York) of the week containing `date`, as YYYY-MM-DD. */
export function weekStartFor(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  const localMidnight = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')))
  const offset = WEEKDAY_OFFSET[get('weekday')] ?? 0
  return new Date(localMidnight - offset * 86400000).toISOString().slice(0, 10)
}

/** Shifts a YYYY-MM-DD date by whole days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}
