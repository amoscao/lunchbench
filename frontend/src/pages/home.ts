import * as Sentry from '@sentry/browser'
import {
  acknowledgeMatchupSeen,
  getMatchup,
  submitVote,
  type Lunch,
  type Matchup,
  type MatchupResult,
  type VoteResult,
} from '../api'
import { isVeganMode } from '../vegan-mode'
import { markSeen } from '../utils/seen-pairs'
import { animateCountUp } from '../utils/count-up'
import { escapeHtml } from '../utils/escape-html'

function renderCard(lunch: Lunch, label: 'DISH A' | 'DISH B'): HTMLElement {
  const card = document.createElement('div')
  card.className = 'lunch-card'

  const mediaArea = lunch.image_url
    ? `<div class="lunch-card-image"><img src="${escapeHtml(lunch.image_url)}" alt="${escapeHtml(lunch.name)}" loading="lazy" /></div>`
    : `<div class="lunch-card-placeholder">
        <div class="placeholder-question">?</div>
        <span class="placeholder-text">no picture yet</span>
       </div>`
  const veganBadge = lunch.is_vegan === 1 ? '<span class="vegan-badge">🌿</span>' : ''
  const description = lunch.description
    ? `<div class="lunch-card-description">${escapeHtml(lunch.description)}</div>`
    : ''

  const shortLabel = label === 'DISH A' ? 'A' : 'B'
  card.innerHTML = `
    <div class="vote-card-label" data-short="${shortLabel}">${label}</div>
    ${mediaArea}
    <div class="lunch-card-info">
      <div class="lunch-card-name">${escapeHtml(lunch.name)}${veganBadge}</div>
      ${description}
    </div>
  `
  return card
}

function renderHowItWorks(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'how-it-works'
  section.innerHTML = `
    <div class="hiw-step">
      <span class="hiw-num">01</span>
      <h3 class="hiw-title">Vote</h3>
      <p class="hiw-desc">Two lunch dishes go head to head. Pick one, call it a tie, or skip dishes you haven't eaten.</p>
    </div>
    <div class="hiw-step">
      <span class="hiw-num">02</span>
      <h3 class="hiw-title">Lunch Score</h3>
      <p class="hiw-desc">Every vote updates each dish's desirability score.</p>
    </div>
    <div class="hiw-step">
      <span class="hiw-num">03</span>
      <h3 class="hiw-title">Leaderboard</h3>
      <p class="hiw-desc">Dish rankings are sent to Paula as feedback.</p>
    </div>
  `
  return section
}

function createVoteButton(
  label: string,
  hint: string,
  onClick: () => void,
  buttonClass: string
): { wrapper: HTMLElement; button: HTMLButtonElement } {
  const wrapper = document.createElement('div')
  wrapper.className = 'vote-button-wrap'

  const hintEl = document.createElement('span')
  hintEl.className = 'vote-key-hint'
  hintEl.textContent = hint

  const button = document.createElement('button')
  button.className = `btn ${buttonClass}`
  button.textContent = label
  button.addEventListener('click', onClick)

  wrapper.appendChild(hintEl)
  wrapper.appendChild(button)

  return { wrapper, button }
}

function renderSkeleton(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;gap:24px;'
  wrap.innerHTML = `
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
  `
  return wrap
}

function renderEmpty(navigate: (p: string) => void, veganOnly: boolean): HTMLElement {
  const div = document.createElement('div')
  div.className = 'state-center'
  div.innerHTML = `
    <div class="state-icon">🍽</div>
    <div class="state-title">No matchups yet!</div>
    <div class="state-desc">${veganOnly ? 'No vegan dishes to compare yet! Add some vegan options.' : 'Add at least two lunches to start voting.'}</div>
  `
  const btn = document.createElement('button')
  btn.className = 'btn btn-primary'
  btn.textContent = 'Add a Lunch'
  btn.addEventListener('click', () => navigate('/add'))
  div.appendChild(btn)
  return div
}

function renderError(retry: () => void): HTMLElement {
  const div = document.createElement('div')
  div.className = 'state-center'
  div.innerHTML = `
    <div class="error-icon-wrap">⚠</div>
    <div class="state-title">Something went wrong</div>
    <div class="state-desc">Could not load a matchup. Check your connection and try again.</div>
  `
  const btn = document.createElement('button')
  btn.className = 'btn btn-secondary'
  btn.textContent = 'Retry'
  btn.addEventListener('click', retry)
  div.appendChild(btn)
  return div
}

function renderRateLimit(retry: () => void): HTMLElement {
  const div = document.createElement('div')
  div.className = 'state-center'
  div.innerHTML = `
    <div class="error-icon-wrap">⚠</div>
    <div class="state-title">Too many requests</div>
    <div class="state-desc">You've loaded too many matchups. Wait a minute and try again.</div>
  `
  const btn = document.createElement('button')
  btn.className = 'btn btn-secondary'
  btn.textContent = 'Retry'
  btn.addEventListener('click', retry)
  div.appendChild(btn)
  return div
}

function renderExhausted(navigate: (p: string) => void): HTMLElement {
  const div = document.createElement('div')
  div.className = 'state-center'
  div.innerHTML = `
    <div class="state-icon">🎉</div>
    <div class="state-title">You've seen them all!</div>
    <div class="state-desc">New matchups may appear as lunches are added. Check back later.</div>
  `
  const btn = document.createElement('button')
  btn.className = 'btn btn-secondary'
  btn.textContent = 'See the leaderboard'
  btn.addEventListener('click', () => navigate('/leaderboard'))
  div.appendChild(btn)
  return div
}

function showVoteOverlay(
  card: HTMLElement,
  lunch: Lunch,
  voteResult: VoteResult
): void {
  const isMobile = window.matchMedia(
  '(max-width: 600px), (orientation: landscape) and (max-height: 520px) and (pointer: coarse)'
).matches
  const rankOutcome = getRankOutcome(lunch.rank, voteResult.rank)
  const colorClass =
    rankOutcome === 'improved' ? 'overlay-rank-up' :
    rankOutcome === 'worsened' ? 'overlay-rank-down' :
    'overlay-rank-neutral'
  const slideClass =
    rankOutcome === 'improved' ? 'rank-slide-down' :
    rankOutcome === 'worsened' ? 'rank-slide-up' :
    'rank-fade'

  if (isMobile) {
    const info = card.querySelector<HTMLElement>('.lunch-card-info')
    if (!info) return

    const statLine = document.createElement('div')
    statLine.className = `vote-stat-line ${colorClass}`

    const rankEl = document.createElement('span')
    rankEl.className = `vote-stat-rank ${slideClass}`
    setRankWidth(rankEl, lunch.rank, voteResult.rank)
    rankEl.appendChild(renderRankOdometry(lunch.rank, voteResult.rank, rankOutcome))

    const sep = document.createElement('span')
    sep.className = 'vote-stat-sep'
    sep.textContent = '·'

    const ratingEl = document.createElement('span')
    ratingEl.className = 'vote-stat-rating'
    ratingEl.textContent = String(Math.round(lunch.conservative_rating))

    statLine.appendChild(rankEl)
    statLine.appendChild(sep)
    statLine.appendChild(ratingEl)
    info.appendChild(statLine)

    animateCountUp(ratingEl, Math.round(voteResult.conservative_rating), (v) => String(v), 800, Math.round(lunch.conservative_rating))
    return
  }

  // Desktop: full card overlay
  const overlay = document.createElement('div')
  overlay.className = `vote-result-overlay ${colorClass}`

  const rankLabel = document.createElement('div')
  rankLabel.className = 'overlay-rank-label'
  rankLabel.textContent = 'Rank'

  const rankValue = document.createElement('div')
  rankValue.className = 'overlay-rank-value'

  const rankNumber = document.createElement('span')
  rankNumber.className = `overlay-rank-number ${slideClass}`
  setRankWidth(rankNumber, lunch.rank, voteResult.rank)
  rankNumber.appendChild(renderRankOdometry(lunch.rank, voteResult.rank, rankOutcome))
  rankValue.appendChild(rankNumber)

  const ratingLabel = document.createElement('div')
  ratingLabel.className = 'overlay-rating-label'
  ratingLabel.textContent = 'Rating'

  const ratingValue = document.createElement('div')
  ratingValue.className = 'overlay-rating-value'
  ratingValue.textContent = String(Math.round(lunch.conservative_rating))

  overlay.appendChild(rankLabel)
  overlay.appendChild(rankValue)
  overlay.appendChild(ratingLabel)
  overlay.appendChild(ratingValue)
  card.appendChild(overlay)

  animateCountUp(ratingValue, Math.round(voteResult.conservative_rating), (v) => String(v), 800, Math.round(lunch.conservative_rating))
}

type RankOutcome = 'improved' | 'worsened' | 'unchanged'

function getRankOutcome(oldRank: number, newRank: number): RankOutcome {
  if (newRank < oldRank) return 'improved'
  if (newRank > oldRank) return 'worsened'
  return 'unchanged'
}

function setRankWidth(element: HTMLElement, oldRank: number, newRank: number): void {
  const width = Math.max(`#${oldRank}`.length, `#${newRank}`.length)
  element.style.setProperty('--rank-width', `${width + 0.5}ch`)
}

function renderRankOdometry(oldRank: number, newRank: number, outcome: RankOutcome): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const newSpan = document.createElement('span')
  newSpan.className = 'rank-new'
  newSpan.textContent = `#${newRank}`

  if (outcome === 'unchanged') {
    fragment.appendChild(newSpan)
    return fragment
  }

  const oldSpan = document.createElement('span')
  oldSpan.className = 'rank-old'
  oldSpan.textContent = `#${oldRank}`
  fragment.appendChild(oldSpan)
  fragment.appendChild(newSpan)
  return fragment
}

export function renderHome(
  container: HTMLElement,
  navigate: (p: string) => void
): (() => void) | void {
  let leftLunch: Lunch | null = null
  let rightLunch: Lunch | null = null
  let currentMatchup: Matchup | null = null
  let nextMatchupPromise: Promise<MatchupResult> | null = null
  let cleanupKeyboard: (() => void) | null = null
  let isSubmitting = false

  function acknowledgeRenderedMatchup(matchup: Matchup): Promise<void> {
    return acknowledgeMatchupSeen(matchup.matchup_token).catch((error: unknown) => {
      Sentry.captureException(error, {
        extra: { leftId: matchup.left.id, rightId: matchup.right.id },
      })
    })
  }

  const castVote = async (result: 'left_win' | 'right_win' | 'tie'): Promise<void> => {
    if (isSubmitting || !leftLunch || !rightLunch || !currentMatchup) return

    isSubmitting = true
    const votedLeft = leftLunch
    const votedRight = rightLunch
    const projected = currentMatchup.projected[result]

    const buttons = document.querySelectorAll<HTMLButtonElement>('.vote-buttons .btn')
    buttons.forEach((b) => (b.disabled = true))

    const bar = document.querySelector<HTMLDivElement>('.vote-gradient-bar')
    if (bar) bar.classList.add('loading')

    // Fade buttons visually
    const voteRow = document.querySelector<HTMLElement>('.vote-buttons')
    if (voteRow) voteRow.classList.add('voted-state')

    // Neon pulse on the voted card(s)
    const cards = document.querySelectorAll<HTMLElement>('.vote-arena .lunch-card')
    // cards[0] = left card, cards[1] = right card (.vote-vs is not a .lunch-card)
    if (result === 'left_win') {
      cards[0]?.classList.add('voted')
    } else if (result === 'right_win') {
      cards[1]?.classList.add('voted')
    } else {
      // tie
      cards[0]?.classList.add('voted')
      cards[1]?.classList.add('voted')
    }

    const leftCard = cards[0]
    const rightCard = cards[1]
    if (leftCard) showVoteOverlay(leftCard, votedLeft, projected.left)
    if (rightCard) showVoteOverlay(rightCard, votedRight, projected.right)

    const delay = new Promise<void>((r) => setTimeout(r, 1500))
    const isRateLimited = (err: unknown): boolean =>
      err instanceof Error && err.message === 'rate_limited'
    const votePromise = submitVote(votedLeft.id, votedRight.id, result).catch(async (firstErr: unknown) => {
      if (isRateLimited(firstErr)) return
      try {
        await submitVote(votedLeft.id, votedRight.id, result)
      } catch (secondErr: unknown) {
        const err = secondErr ?? firstErr
        if (!isRateLimited(err)) {
          Sentry.captureException(err, {
            extra: { leftId: votedLeft.id, rightId: votedRight.id, result, attempt: 2 },
          })
        }
      }
    })

    try {
      await Promise.all([delay, votePromise])

      let next: MatchupResult
      try {
        next = await (nextMatchupPromise ?? getMatchup(isVeganMode()))
      } catch {
        next = await getMatchup(isVeganMode())
      }
      await load(next)
    } catch {
      if (bar) bar.classList.remove('loading')
      await load(undefined)
    } finally {
      isSubmitting = false
    }
  }

  const skipMatchup = async (): Promise<void> => {
    if (isSubmitting || !leftLunch || !rightLunch || !currentMatchup) return

    isSubmitting = true
    const buttons = document.querySelectorAll<HTMLButtonElement>('.vote-buttons .btn')
    buttons.forEach((b) => (b.disabled = true))

    const bar = document.querySelector<HTMLDivElement>('.vote-gradient-bar')
    if (bar) bar.classList.add('loading')

    try {
      let next: MatchupResult
      try {
        next = await (nextMatchupPromise ?? getMatchup(isVeganMode()))
      } catch {
        next = await getMatchup(isVeganMode())
      }
      await load(next)
    } catch {
      if (bar) bar.classList.remove('loading')
      await load(undefined)
    } finally {
      isSubmitting = false
    }
  }

  const addKeyboardShortcuts = (): void => {
    const handler = (event: KeyboardEvent): void => {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return
      }

      if (event.key === '1') {
        void castVote('left_win')
      } else if (event.key === '2') {
        void castVote('tie')
      } else if (event.key === '3') {
        void castVote('right_win')
      } else if (event.key === '4') {
        void skipMatchup()
      }
    }

    cleanupKeyboard?.()
    document.addEventListener('keydown', handler)
    cleanupKeyboard = () => {
      document.removeEventListener('keydown', handler)
      cleanupKeyboard = null
    }
  }

  async function load(matchup?: MatchupResult): Promise<void> {
    if (matchup === undefined) {
      // Initial load - show skeleton.
      container.innerHTML = ''
      const content = document.createElement('div')
      content.className = 'page-content'
      container.appendChild(content)
      content.appendChild(renderSkeleton())
      try {
        const data = await getMatchup(isVeganMode())
        await load(data)
      } catch (error) {
        content.innerHTML = ''
        if (error instanceof Error && error.message === 'rate_limited') {
          content.appendChild(renderRateLimit(() => load(undefined)))
        } else {
          content.appendChild(renderError(() => load(undefined)))
        }
      }
      return
    }

    const content = document.createElement('div')
    content.className = 'page-content'

    if (!matchup) {
      currentMatchup = null
      nextMatchupPromise = null
      content.appendChild(renderEmpty(navigate, isVeganMode()))
      container.replaceChildren(content)
      return
    }

    if (matchup.status === 'exhausted') {
      currentMatchup = null
      nextMatchupPromise = null
      content.appendChild(renderExhausted(navigate))
      container.replaceChildren(content)
      return
    }

    markSeen(matchup.left.id, matchup.right.id)

    currentMatchup = matchup
    leftLunch = matchup.left
    rightLunch = matchup.right

    const arena = document.createElement('div')
    arena.className = 'vote-arena'
    arena.appendChild(renderCard(leftLunch, 'DISH A'))
    const vs = document.createElement('div')
    vs.className = 'vote-vs'
    vs.textContent = 'VS'
    arena.appendChild(vs)
    arena.appendChild(renderCard(rightLunch, 'DISH B'))
    const reducedMotionFadeIn = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    content.appendChild(arena)

    const gradientBar = document.createElement('div')
    gradientBar.className = 'vote-gradient-bar'
    content.appendChild(gradientBar)

    const voteRow = document.createElement('div')
    voteRow.className = 'vote-buttons'

    const left = createVoteButton('A wins', '[1]', () => void castVote('left_win'), 'btn-primary')
    const tie = createVoteButton('Tie', '[2]', () => void castVote('tie'), 'btn-secondary')
    const right = createVoteButton('B wins', '[3]', () => void castVote('right_win'), 'btn-primary')
    const skip = createVoteButton("Haven't Eaten", '[4]', () => void skipMatchup(), 'btn-secondary')

    voteRow.appendChild(left.wrapper)
    voteRow.appendChild(tie.wrapper)
    voteRow.appendChild(right.wrapper)
    voteRow.appendChild(skip.wrapper)

    const hintPulse = (btn: HTMLButtonElement): void => {
      btn.classList.remove('btn-hint-pulse')
      // Force reflow so re-adding the class re-triggers the animation
      void btn.offsetWidth
      btn.classList.add('btn-hint-pulse')
      btn.addEventListener('animationend', () => btn.classList.remove('btn-hint-pulse'), { once: true })
    }

    const arenaCards = arena.querySelectorAll<HTMLElement>('.lunch-card')
    arenaCards[0]?.addEventListener('click', () => { if (!isSubmitting) hintPulse(left.button) })
    arenaCards[1]?.addEventListener('click', () => { if (!isSubmitting) hintPulse(right.button) })
    content.appendChild(voteRow)
    content.appendChild(renderHowItWorks())

    container.replaceChildren(content)
    if (!reducedMotionFadeIn) arena.classList.add('fading-in')

    addKeyboardShortcuts()
    acknowledgeRenderedMatchup(matchup).catch(() => {})
    nextMatchupPromise = getMatchup(isVeganMode())
  }

  load(undefined)
  addKeyboardShortcuts()

  return () => {
    cleanupKeyboard?.()
  }
}
