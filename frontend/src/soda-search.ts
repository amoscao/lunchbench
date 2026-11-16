// Type-ahead search over the soda catalog for "Report a soda". Runs locally on every keystroke.
// The lunch search keeps using fuzzy.ts; this matcher is soda-specific.

export type SearchableSoda = {
  id: number
  brand: string
  flavor: string
  type: 'soda' | 'seltzer'
}

const WALMART_BRANDS = ['great value', 'sams choice', 'bettergoods']
const ZERO_OR_DIET = ['zero', 'diet']
const SELTZERS = ['seltzer']
const SODAS = ['soda']

/**
 * Nicknames. Key: a normalized query phrase. Value: alternatives; a drink matches the alias when
 * all words of ANY one alternative match it. The words the user typed always count as one more
 * alternative, so an alias only ever widens a search. Longer keys win ("diet coke" over "coke").
 * Extend by adding entries; keys and values use normalized text (see normalizeText).
 */
export const SODA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'coke': ['coca cola'],
  'coca cola': ['coca cola'],
  'cocacola': ['coca cola'],
  'diet coke': ['coca cola diet'],
  'coke zero': ['coca cola zero'],
  'pepsi max': ['pepsi zero'],
  'dew': ['mountain dew'],
  'mtn': ['mountain'],
  'mtn dew': ['mountain dew'],
  'mountain do': ['mountain dew'],
  'baja': ['mountain dew baja blast'],
  'dp': ['dr pepper'],
  'dr p': ['dr pepper'],
  'doctor pepper': ['dr pepper'],
  'root beer': ['root beer'],
  'rootbeer': ['root beer'],
  'ginger ale': ['ginger ale'],
  'gingerale': ['ginger ale'],
  'la croix': ['lacroix'],
  'lacroix': ['lacroix'],
  'bubbly': ['bubly'],
  'gv': WALMART_BRANDS,
  'great value': WALMART_BRANDS,
  'walmart': WALMART_BRANDS,
  'walmart brand': WALMART_BRANDS,
  'olipop': ['olipop'],
  'oli pop': ['olipop'],
  'poppy': ['poppi'],
  'seltzer': SELTZERS,
  'seltzers': SELTZERS,
  'sparkling': SELTZERS,
  'sparkling water': SELTZERS,
  'fizzy water': SELTZERS,
  'soda': SODAS,
  'sodas': SODAS,
  'pop': SODAS,
  'zero': ZERO_OR_DIET,
  'diet': ZERO_OR_DIET,
  'sugar free': ZERO_OR_DIET,
  'orange': ['orange', 'tangerine', 'mandarin'],
  'cherry': ['cherry'],
  'lemon lime': ['lemon lime', 'sprite original', 'sprite zero', '7up original'],
}

export const MAX_RESULTS = 8
const STOPWORDS = new Set(['and'])
const MAX_ALIAS_WORDS = 3

/** Lowercase, no accents, no apostrophes or periods, "&" and other punctuation become spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function words(text: string): string[] {
  const normalized = normalizeText(text)
  return normalized ? normalized.split(' ') : []
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions. */
export function damerauDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

/** Typos allowed in a query word: none under 4 letters, 1 for 4-7, 2 for 8 or more. */
export function allowedTypos(length: number): number {
  if (length >= 8) return 2
  if (length >= 4) return 1
  return 0
}

const EXACT = 3
const PREFIX = 2
const TYPO = 1
const NONE = 0

type Indexed<T> = { soda: T; order: number; words: string[]; wordCount: number }

function indexSoda<T extends SearchableSoda>(soda: T, order: number): Indexed<T> {
  const brand = words(soda.brand)
  const flavor = words(soda.flavor)
  const all = new Set([
    ...brand,
    ...flavor,
    brand.join(''),
    flavor.join(''),
    soda.type,
  ])
  return { soda, order, words: [...all].filter(Boolean), wordCount: brand.length + flavor.length }
}

function matchWord(token: string, candidates: string[], allowTypo: boolean): number {
  let best = NONE
  const typos = allowTypo ? allowedTypos(token.length) : 0
  for (const word of candidates) {
    if (word === token) return EXACT
    if (word.startsWith(token)) {
      best = Math.max(best, PREFIX)
      continue
    }
    if (best >= TYPO || typos === 0) continue
    // A typo against the whole word, or against its start while the user is still typing.
    if (Math.abs(word.length - token.length) <= typos && damerauDistance(token, word) <= typos) best = TYPO
    else if (word.length > token.length && damerauDistance(token, word.slice(0, token.length)) <= typos) best = TYPO
  }
  return best
}

type Term = {
  /** What the user typed for this term. */
  literal: string[]
  /** The literal words first, then alias expansions. */
  alternatives: string[][]
  /** No alias: may merge with a neighbor ("la croix" -> "lacroix"). */
  mergeable: boolean
}

export function parseQuery(query: string): Term[] {
  const tokens = words(query).filter((token) => !STOPWORDS.has(token))
  const terms: Term[] = []
  let i = 0
  while (i < tokens.length) {
    let matched = false
    for (let length = Math.min(MAX_ALIAS_WORDS, tokens.length - i); length >= 1; length--) {
      const phrase = tokens.slice(i, i + length)
      const expansions = SODA_ALIASES[phrase.join(' ')]
      if (!expansions) continue
      terms.push({
        literal: phrase,
        alternatives: [phrase, ...expansions.map((expansion) => expansion.split(' '))],
        mergeable: false,
      })
      i += length
      matched = true
      break
    }
    if (!matched) {
      terms.push({ literal: [tokens[i]], alternatives: [[tokens[i]]], mergeable: true })
      i += 1
    }
  }
  return terms
}

/**
 * Typos are only forgiven for words the catalog does not know. A real word such as "diet" or
 * "cola" must match as typed, so it never drags in look-alikes ("dirty", "coca").
 */
type TypoPolicy = (token: string) => boolean

function matchAlternative(alternative: string[], candidates: string[], allowTypo: TypoPolicy): number {
  let quality = EXACT
  for (const token of alternative) {
    quality = Math.min(quality, matchWord(token, candidates, allowTypo(token)))
    if (quality === NONE) return NONE
  }
  return quality
}

type Match = { typos: number; literalHits: number; quality: number }

const NO_TYPOS: TypoPolicy = () => false

function matchSoda(terms: Term[], candidates: string[], allowTypo: TypoPolicy): Match | null {
  let typos = 0
  let literalHits = 0
  let quality = 0
  let i = 0
  while (i < terms.length) {
    // "la croix", "a and w": two or three typed words that together exact- or prefix-match one word.
    let merged = 0
    for (let span = 3; span >= 2 && merged === 0; span--) {
      const group = terms.slice(i, i + span)
      if (group.length < span || !group.every((term) => term.mergeable)) continue
      const q = matchWord(group.map((term) => term.literal[0]).join(''), candidates, false)
      if (q >= PREFIX) {
        merged = span
        literalHits += span
        quality += q * span
      }
    }
    if (merged > 0) {
      i += merged
      continue
    }

    const term = terms[i]
    // The typed words may carry typos; alias expansions are canonical and must match as written.
    const best = Math.max(...term.alternatives.map((alternative, index) =>
      matchAlternative(alternative, candidates, index === 0 ? allowTypo : NO_TYPOS)
    ))
    if (best === NONE) return null
    if (best === TYPO) typos += 1
    if (matchAlternative(term.literal, candidates, NO_TYPOS) >= PREFIX) literalHits += 1
    quality += best
    i += 1
  }
  return { typos, literalHits, quality }
}

/**
 * Every typed word (or alias) must match the drink's brand, flavor, combined name or type.
 * Ranking: fewer typo matches first (exact, prefix and alias hits beat typos), then more words
 * matched as typed, then higher match quality, then shorter names, then catalog order.
 */
export function searchSodas<T extends SearchableSoda>(query: string, sodas: T[], limit = MAX_RESULTS): T[] {
  const terms = parseQuery(query)
  if (terms.length === 0) return []
  const indexed = sodas.map((soda, order) => indexSoda(soda, order))
  const vocabulary = [...new Set(indexed.flatMap((entry) => entry.words))]
  const known = new Map<string, boolean>()
  const allowTypo: TypoPolicy = (token) => {
    if (!known.has(token)) known.set(token, vocabulary.some((word) => word.startsWith(token)))
    return !known.get(token)
  }
  return indexed
    .map((entry) => ({ indexed: entry, match: matchSoda(terms, entry.words, allowTypo) }))
    .filter((entry): entry is { indexed: Indexed<T>; match: Match } => entry.match !== null)
    .sort((a, b) =>
      a.match.typos - b.match.typos
      || b.match.literalHits - a.match.literalHits
      || b.match.quality - a.match.quality
      || a.indexed.wordCount - b.indexed.wordCount
      || a.indexed.order - b.indexed.order
    )
    .slice(0, limit)
    .map((entry) => entry.indexed.soda)
}
