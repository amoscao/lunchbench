import { getMatchup, submitVote, type Lunch, type VoteResult } from '../api'
import { isVeganMode } from '../vegan-mode'
import { hasSeen, markSeen } from '../utils/seen-pairs'
import { animateCountUp } from '../utils/count-up'

function renderCard(lunch: Lunch, label: 'DISH A' | 'DISH B'): HTMLElement {
  const card = document.createElement('div')
  card.className = 'lunch-card'

  const mediaArea = lunch.image_url
    ? `<div class="lunch-card-image"><img src="${lunch.image_url}" alt="${lunch.name}" loading="lazy" /></div>`
    : `<div class="lunch-card-placeholder">
        <div class="placeholder-question">?</div>
        <span class="placeholder-text">no picture yet</span>
       </div>`
  const veganBadge = lunch.is_vegan === 1 ? '<span class="vegan-badge">🌿</span>' : ''
  const description = lunch.description
    ? `<div class="lunch-card-description">${lunch.description}</div>`
    : ''

  const shortLabel = label === 'DISH A' ? 'A' : 'B'
  card.innerHTML = `
    <div class="vote-card-label" data-short="${shortLabel}">${label}</div>
    ${mediaArea}
    <div class="lunch-card-info">
      <div class="lunch-card-name">${lunch.name}${veganBadge}</div>
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
      <p class="hiw-desc">Two lunch dishes go head to head. Pick the one you'd rather eat or call it a tie.</p>
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

function showVoteOverlay(
  card: HTMLElement,
  lunch: Lunch,
  voteResult: VoteResult,
  colorClass: 'overlay-rank-up' | 'overlay-rank-down' | 'overlay-rank-neutral'
): void {
  const overlay = document.createElement('div')
  overlay.className = `vote-result-overlay ${colorClass}`

  const rankLabel = document.createElement('div')
  rankLabel.className = 'overlay-rank-label'
  rankLabel.textContent = 'Rank'

  const rankValue = document.createElement('div')
  rankValue.className = 'overlay-rank-value'

  const rankNumber = document.createElement('span')
  rankNumber.className = 'overlay-rank-number'
  rankNumber.textContent = `#${voteResult.rank}`
  rankValue.appendChild(rankNumber)

  const ratingLabel = document.createElement('div')
  ratingLabel.className = 'overlay-rating-label'
  ratingLabel.textContent = 'Rating'

  const ratingValue = document.createElement('div')
  ratingValue.className = 'overlay-rating-value'
  ratingValue.textContent = String(Math.round(lunch.rating))

  overlay.appendChild(rankLabel)
  overlay.appendChild(rankValue)
  overlay.appendChild(ratingLabel)
  overlay.appendChild(ratingValue)
  card.appendChild(overlay)

  animateCountUp(
    ratingValue,
    Math.round(voteResult.conservative_rating),
    (v) => String(v),
    800,
    Math.round(lunch.rating)
  )
}

export function renderHome(
  container: HTMLElement,
  navigate: (p: string) => void
): (() => void) | void {
  let leftLunch: Lunch | null = null
  let rightLunch: Lunch | null = null
  let cleanupKeyboard: (() => void) | null = null
  let isSubmitting = false

  const castVote = async (result: 'left_win' | 'right_win' | 'tie'): Promise<void> => {
    if (isSubmitting || !leftLunch || !rightLunch) return

    isSubmitting = true

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

    const delay = new Promise<void>((r) => setTimeout(r, 2000))

    try {
      const [res] = await Promise.all([
        submitVote(leftLunch.id, rightLunch.id, result).then((r) => {
          const leftCard = cards[0]
          const rightCard = cards[1]
          const leftColor =
            result === 'left_win' ? 'overlay-rank-up' :
            result === 'right_win' ? 'overlay-rank-down' :
            'overlay-rank-neutral'
          const rightColor =
            result === 'right_win' ? 'overlay-rank-up' :
            result === 'left_win' ? 'overlay-rank-down' :
            'overlay-rank-neutral'
          if (leftCard && leftLunch) showVoteOverlay(leftCard, leftLunch, r.left_result, leftColor)
          if (rightCard && rightLunch) showVoteOverlay(rightCard, rightLunch, r.right_result, rightColor)
          return r
        }),
        delay,
      ])

      // Fade out the arena, then load next matchup
      const arena = document.querySelector<HTMLElement>('.vote-arena')
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (arena && !reducedMotion) {
        arena.classList.add('fading-out')
        await new Promise<void>((r) => setTimeout(r, 260))
      }

      await load(res.next)
    } catch (e) {
      if (bar) bar.classList.remove('loading')
      buttons.forEach((b) => (b.disabled = false))
      const err = document.createElement('p')
      err.style.cssText = 'text-align:center;color:#dc2626;margin-top:12px;font-size:13px;'
      err.textContent =
        e instanceof Error && e.message === 'rate_limited'
          ? 'Slow down! You\'ve voted a lot. Try again in a bit.'
          : 'Vote failed. Try again.'
      const content = container.firstElementChild as HTMLElement
      content?.appendChild(err)
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
      }
    }

    cleanupKeyboard?.()
    document.addEventListener('keydown', handler)
    cleanupKeyboard = () => {
      document.removeEventListener('keydown', handler)
      cleanupKeyboard = null
    }
  }

  async function load(matchup?: { left: Lunch; right: Lunch } | null): Promise<void> {
    container.innerHTML = ''
    const content = document.createElement('div')
    content.className = 'page-content'
    container.appendChild(content)

    if (matchup === undefined) {
      // Initial load - show skeleton.
      content.appendChild(renderSkeleton())
      try {
        const data = await getMatchup(isVeganMode())
        await load(data)
      } catch {
        content.innerHTML = ''
        content.appendChild(renderError(() => load(undefined)))
      }
      return
    }

    if (!matchup) {
      content.appendChild(renderEmpty(navigate, isVeganMode()))
      return
    }

    let currentMatchup: { left: Lunch; right: Lunch } | null = matchup
    let retries = 0
    while (currentMatchup && hasSeen(currentMatchup.left.id, currentMatchup.right.id) && retries < 10) {
      currentMatchup = await getMatchup(isVeganMode())
      retries++
    }
    if (!currentMatchup) {
      content.appendChild(renderEmpty(navigate, isVeganMode()))
      return
    }
    markSeen(currentMatchup.left.id, currentMatchup.right.id)

    leftLunch = currentMatchup.left
    rightLunch = currentMatchup.right

    const arena = document.createElement('div')
    arena.className = 'vote-arena'
    arena.appendChild(renderCard(leftLunch, 'DISH A'))
    const vs = document.createElement('div')
    vs.className = 'vote-vs'
    vs.textContent = 'VS'
    arena.appendChild(vs)
    arena.appendChild(renderCard(rightLunch, 'DISH B'))
    const reducedMotionFadeIn = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reducedMotionFadeIn) arena.classList.add('fading-in')
    content.appendChild(arena)

    const gradientBar = document.createElement('div')
    gradientBar.className = 'vote-gradient-bar'
    content.appendChild(gradientBar)

    const voteRow = document.createElement('div')
    voteRow.className = 'vote-buttons'

    const left = createVoteButton('A wins', '[1]', () => void castVote('left_win'), 'btn-primary')
    const tie = createVoteButton('Tie', '[2]', () => void castVote('tie'), 'btn-secondary')
    const right = createVoteButton('B wins', '[3]', () => void castVote('right_win'), 'btn-primary')

    voteRow.appendChild(left.wrapper)
    voteRow.appendChild(tie.wrapper)
    voteRow.appendChild(right.wrapper)

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

    addKeyboardShortcuts()
  }

  load(undefined)
  addKeyboardShortcuts()

  return () => {
    cleanupKeyboard?.()
  }
}
