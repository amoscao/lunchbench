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
 * alternative, so an alias only ever widens a search. Longer keys win. While the last word is
 * still being typed, keys that start with it count too ("cok" -> coke).
 * Extend by adding entries; keys and values use normalized text (see normalizeText).
 * Keys that map to themselves ("root beer", "olipop", "cherry") are kept on purpose: they record
 * the product owner's alias list, even though plain matching already finds them.
 */
export const SODA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'coke': ['coca cola'],
  'coca cola': ['coca cola'],
  'cocacola': ['coca cola'],
  // "diet coke" and "coke zero" need no keys: coke + diet/zero combine in either word order.
  'max': ['zero'],
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
  'creme': ['cream'],
}

export const MAX_RESULTS = 8
/** Words beyond this are ignored; no drink name needs more, and it bounds the matching work. */
export const MAX_QUERY_WORDS = 8
const STOPWORDS = new Set(['and'])
const MAX_ALIAS_WORDS = 3
/** Flavors that mark a brand's flagship. They don't count toward name length, so "coke" lists Original first. */
const FLAGSHIP_WORDS = new Set(['original', 'pure'])

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

/** Match kinds, best first. */
const EXACT = 4
const PREFIX = 3
const INFIX = 2
const TYPO = 1
/** Typo against the start of a longer word ("lemonaid" vs "lemonl…") ranks after a whole-word typo. */
const PARTIAL_TYPO_PENALTY = 0.5

type WordMatch = { quality: number; distance: number }

type Indexed<T> = {
  soda: T
  order: number
  /** Brand and flavor words plus their compact forms ("lacroix", "drpepper", "aw"). */
  words: string[]
  /** Compact forms only serve spacing variants, so they never match inside a word. */
  compact: boolean[]
  typeWord: string
  wordCount: number
}

function indexSoda<T extends SearchableSoda>(soda: T, order: number): Indexed<T> {
  const brand = words(soda.brand)
  const flavor = words(soda.flavor)
  // Repeated words stay separate entries ("Mountain Dew Dirty Dew" has two "dew"s), so a query
  // can give each typed "dew" its own catalog word. Only the compact forms are deduped.
  const plain = [...brand, ...flavor]
  const compacts = [brand.join(''), flavor.join('')].filter((word) => word && !plain.includes(word))
  return {
    soda,
    order,
    words: [...plain, ...new Set(compacts)],
    compact: [...plain.map(() => false), ...[...new Set(compacts)].map(() => true)],
    typeWord: soda.type,
    wordCount: brand.length + flavor.filter((word) => !FLAGSHIP_WORDS.has(word)).length,
  }
}

/**
 * How well one query token matches one catalog word, or null.
 * - exact, then prefix (while typing), then inside a word for tokens of 4+ letters ("berry");
 * - typos only when `allowTypo` (the catalog has no word containing the token): a whole-word typo,
 *   or a typo against the start of a longer word for tokens of 5+ letters with the same first letter.
 */
function matchWord(token: string, word: string, allowTypo: boolean, compact = false): WordMatch | null {
  if (word === token) return { quality: EXACT, distance: 0 }
  if (word.startsWith(token)) return { quality: PREFIX, distance: 0 }
  if (!compact && token.length >= 4 && word.includes(token)) return { quality: INFIX, distance: 0 }
  if (!allowTypo) return null
  const typos = allowedTypos(token.length)
  if (typos === 0) return null
  if (Math.abs(word.length - token.length) <= typos) {
    const distance = damerauDistance(token, word)
    if (distance <= typos) return { quality: TYPO, distance }
  }
  if (token.length >= 5 && word.length > token.length && word[0] === token[0]) {
    const distance = damerauDistance(token, word.slice(0, token.length))
    if (distance <= typos) return { quality: TYPO, distance: distance + PARTIAL_TYPO_PENALTY }
  }
  return null
}

type Alternative = {
  tokens: string[]
  /** Position in the term's list: 0 = as typed, then alias expansions in listed order. */
  rank: number
  /** Matched as the user typed it (not via an alias). */
  literal: boolean
  /** Best quality this alternative may score: alias keys matched by prefix cap at PREFIX. */
  cap: number
}

type Term = {
  literal: string[]
  alternatives: Alternative[]
  /** No alias: may merge with a neighbor ("la croix" -> "lacroix"). */
  mergeable: boolean
}

/**
 * The typed words, then each alias expansion once, in order. Expansions identical to the typed
 * words or to an earlier expansion are dropped, so self-mapped keys add no extra work.
 */
function buildAlternatives(phrase: string[], expansions: Array<{ text: string; cap: number }>): Alternative[] {
  const seen = new Set([phrase.join(' ')])
  const out: Alternative[] = [{ tokens: phrase, literal: true, cap: EXACT, rank: 0 }]
  for (const { text, cap } of expansions) {
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ tokens: text.split(' '), literal: false, cap, rank: out.length })
  }
  return out
}

/**
 * Alias keys the user may still be typing. All typed words but the last must match the key's
 * words exactly; the last typed word is a prefix of the next key word. The key may be longer than
 * what was typed so far ("doctor" -> "doctor pepper", "fizzy" -> "fizzy water").
 */
function prefixAliasKeys(phrase: string[]): string[] {
  const last = phrase.length - 1
  return Object.keys(SODA_ALIASES).filter((key) => {
    const keyWords = key.split(' ')
    if (keyWords.length < phrase.length) return false
    if (keyWords.join(' ') === phrase.join(' ')) return false
    return phrase.every((word, i) => (i === last ? keyWords[i].startsWith(word) : keyWords[i] === word))
  })
}

export function parseQuery(query: string): Term[] {
  const tokens = words(query).filter((token) => !STOPWORDS.has(token)).slice(0, MAX_QUERY_WORDS)
  const terms: Term[] = []
  let i = 0
  while (i < tokens.length) {
    let matched = false
    for (let length = Math.min(MAX_ALIAS_WORDS, tokens.length - i); length >= 1; length--) {
      const phrase = tokens.slice(i, i + length)
      const exact = SODA_ALIASES[phrase.join(' ')]
      const endsQuery = i + length === tokens.length
      // The user may still be typing the last word: "cok", "doctor p", "fizzy w".
      const partialKeys = endsQuery ? prefixAliasKeys(phrase) : []
      if (!exact && partialKeys.length === 0) continue
      // The typed words always stay an alternative ("cok" may also be a brand prefix).
      terms.push({
        literal: phrase,
        alternatives: buildAlternatives(phrase, [
          ...(exact ?? []).map((text) => ({ text, cap: EXACT })),
          ...partialKeys.flatMap((key) => SODA_ALIASES[key].map((text) => ({ text, cap: PREFIX }))),
        ]),
        mergeable: false,
      })
      i += length
      matched = true
      break
    }
    if (!matched) {
      terms.push({ literal: [tokens[i]], alternatives: buildAlternatives([tokens[i]], []), mergeable: true })
      i += 1
    }
  }
  return terms
}

/**
 * Query variants: adjacent plain words may merge into one ("la croix" -> "lacroix",
 * "a w" -> "aw"). Each variant is scored and the best one counts.
 */
function variants(terms: Term[]): Term[][] {
  const out: Term[][] = [terms]
  for (let i = 0; i < terms.length; i++) {
    for (let span = 2; span <= 3 && i + span <= terms.length; span++) {
      const group = terms.slice(i, i + span)
      if (!group.every((term) => term.mergeable)) continue
      const merged = group.map((term) => term.literal[0]).join('')
      const term: Term = { literal: [merged], alternatives: buildAlternatives([merged], []), mergeable: false }
      out.push([...terms.slice(0, i), term, ...terms.slice(i + span)])
    }
  }
  return out
}

type Score = {
  typeOnly: number
  typos: number
  distance: number
  literalHits: number
  quality: number
  /** Sum of the alias positions used; on ties the first-listed expansion wins ("gv" -> Great Value). */
  aliasRank: number
}

function compareScores(a: Score, b: Score): number {
  return a.typeOnly - b.typeOnly || a.typos - b.typos || a.distance - b.distance
    || b.literalHits - a.literalHits || b.quality - a.quality || a.aliasRank - b.aliasRank
}

function better(a: Score, b: Score): boolean {
  return compareScores(a, b) < 0
}

type Slot = { tokens: string[]; literal: boolean; cap: number; termIndex: number; typoFree: boolean }

/**
 * Best way to give every query word its OWN catalog word (one catalog word cannot satisfy two
 * query words: "coka cola" must not match "Zevia Cola" twice). The type word ("soda"/"seltzer")
 * is a last resort that any number of words may share, and it ranks below brand/flavor matches.
 */
function scoreTerms(
  terms: Term[],
  entry: Indexed<SearchableSoda>,
  allowTypo: (token: string) => boolean,
  freeFallback: boolean
): Score | null {
  let best: Score | null = null
  const used = new Set<number>()
  const literalHit = new Array<boolean>(terms.length).fill(false)

  const tokenOptions = (token: string, cap: number): Array<{ word: number; match: WordMatch }> => {
    const typo = allowTypo(token)
    const options: Array<{ word: number; match: WordMatch }> = []
    entry.words.forEach((word, index) => {
      const match = matchWord(token, word, typo, entry.compact[index])
      if (match) options.push({ word: index, match: { ...match, quality: Math.min(match.quality, cap) } })
    })
    return options
  }

  const searchTerm = (termIndex: number, acc: Score): void => {
    if (termIndex === terms.length) {
      const final = { ...acc, literalHits: literalHit.filter(Boolean).length }
      if (!best || better(final, best)) best = final
      return
    }
    for (const alternative of terms[termIndex].alternatives) {
      searchTokens(
        { tokens: alternative.tokens, literal: alternative.literal, cap: alternative.cap, termIndex, typoFree: true },
        0,
        { ...acc, aliasRank: acc.aliasRank + alternative.rank }
      )
    }
  }

  const searchTokens = (slot: Slot, tokenIndex: number, acc: Score): void => {
    if (tokenIndex === slot.tokens.length) {
      const before = literalHit[slot.termIndex]
      // Counts as "matched as typed" only through the typed words themselves, with no typo.
      if (slot.literal && slot.typoFree) literalHit[slot.termIndex] = true
      searchTerm(slot.termIndex + 1, acc)
      literalHit[slot.termIndex] = before
      return
    }
    const token = slot.tokens[tokenIndex]
    const options = tokenOptions(token, slot.cap)
    let triedWord = false
    for (const option of options) {
      if (used.has(option.word)) continue
      triedWord = true
      used.add(option.word)
      const next = option.match.quality === TYPO ? { ...slot, typoFree: false } : slot
      searchTokens(next, tokenIndex + 1, {
        ...acc,
        typos: acc.typos + (option.match.quality === TYPO ? 1 : 0),
        distance: acc.distance + option.match.distance,
        quality: acc.quality + option.match.quality,
      })
      used.delete(option.word)
    }
    // The type word: "s" or "selt" can still match, but ranks below any brand/flavor match. The
    // strict pass only tries it when no unused brand/flavor word fits, which keeps the search linear
    // for queries like "seltzer seltzer seltzer…". If that pass cannot place every word (a bare "s"
    // took the only s-word that "sc" needed), the caller retries with the type word always allowed.
    if ((freeFallback || !triedWord) && entry.typeWord.startsWith(token)) {
      searchTokens(slot, tokenIndex + 1, { ...acc, typeOnly: acc.typeOnly + 1 })
    }
  }

  searchTerm(0, { typeOnly: 0, typos: 0, distance: 0, literalHits: 0, quality: 0, aliasRank: 0 })
  return best
}

/**
 * Cheap pre-check: every term has at least one alternative whose words each match some catalog
 * word or the type word. Drinks that fail it are skipped before any backtracking.
 */
function feasible(terms: Term[], entry: Indexed<SearchableSoda>, allowTypo: (token: string) => boolean): boolean {
  return terms.every((term) => term.alternatives.some((alternative) => alternative.tokens.every((token) =>
    entry.typeWord.startsWith(token)
    || entry.words.some((word, index) => matchWord(token, word, allowTypo(token), entry.compact[index]) !== null)
  )))
}

/**
 * Every typed word (or alias) must match the drink's brand, flavor, combined name or type.
 * Ranking, in order:
 * 1. fewer words matched only by the type word ("soda"/"seltzer");
 * 2. fewer typo matches (exact, prefix, inside-a-word and alias hits beat typos);
 * 3. smaller total edit distance;
 * 4. more words matched as typed (not via an alias);
 * 5. better match quality (exact > prefix > inside a word);
 * 6. the first-listed alias expansion ("gv" lists Great Value before Sam's Choice);
 * 7. shorter names, not counting "Original"/"Pure", so a brand query lists its flagship first;
 * 8. catalog order.
 * Only the first 8 query words count.
 */
export function searchSodas<T extends SearchableSoda>(query: string, sodas: T[], limit = MAX_RESULTS): T[] {
  const terms = parseQuery(query)
  if (terms.length === 0) return []
  const indexed = sodas.map((soda, order) => indexSoda(soda, order))
  const vocabulary = [...new Set(indexed.flatMap((entry) => entry.words.filter((_, i) => !entry.compact[i])))]
  const known = new Map<string, boolean>()
  // Typos are only forgiven for words no catalog word contains: "diet" and "cola" must match
  // as typed, so they never drag in look-alikes ("dirty", "coca").
  const allowTypo = (token: string): boolean => {
    if (!known.has(token)) known.set(token, vocabulary.some((word) => word.includes(token)))
    return !known.get(token)
  }
  const queryVariants = variants(terms)

  return indexed
    .map((entry) => {
      const typed = entry as Indexed<SearchableSoda>
      let best: Score | null = null
      for (const variant of queryVariants) {
        if (!feasible(variant, typed, allowTypo)) continue
        const score = scoreTerms(variant, typed, allowTypo, false) ?? scoreTerms(variant, typed, allowTypo, true)
        if (score && (!best || better(score, best))) best = score
      }
      return { entry, score: best }
    })
    .filter((result): result is { entry: Indexed<T>; score: Score } => result.score !== null)
    .sort((a, b) =>
      compareScores(a.score, b.score)
      || a.entry.wordCount - b.entry.wordCount
      || a.entry.order - b.entry.order
    )
    .slice(0, limit)
    .map((result) => result.entry.soda)
}
