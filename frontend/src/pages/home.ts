import { getMatchup, submitVote, type Lunch } from '../api'

function truncate(s: string, n = 20): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function renderCard(lunch: Lunch): HTMLElement {
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

  card.innerHTML = `
    ${mediaArea}
    <div class="lunch-card-info">
      <div class="lunch-card-name">${lunch.name}${veganBadge}</div>
      ${description}
      <div class="lunch-card-stats">Elo ${Math.round(lunch.rating)} · ${lunch.wins}W ${lunch.losses}L ${lunch.ties}T</div>
    </div>
  `
  return card
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

function renderEmpty(navigate: (p: string) => void): HTMLElement {
  const div = document.createElement('div')
  div.className = 'state-center'
  div.innerHTML = `
    <div class="state-icon">🍽</div>
    <div class="state-title">No matchups yet!</div>
    <div class="state-desc">Add at least two lunches to start voting.</div>
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

export function renderHome(container: HTMLElement, navigate: (p: string) => void): void {
  let leftLunch: Lunch | null = null
  let rightLunch: Lunch | null = null

  async function load(matchup?: { left: Lunch; right: Lunch } | null): Promise<void> {
    container.innerHTML = ''
    const content = document.createElement('div')
    content.className = 'page-content'
    container.appendChild(content)

    if (matchup === undefined) {
      // Initial load - show skeleton.
      content.appendChild(renderSkeleton())
      try {
        const data = await getMatchup()
        await load(data)
      } catch {
        content.innerHTML = ''
        content.appendChild(renderError(() => load(undefined)))
      }
      return
    }

    if (!matchup) {
      content.appendChild(renderEmpty(navigate))
      return
    }

    leftLunch = matchup.left
    rightLunch = matchup.right

    const arena = document.createElement('div')
    arena.className = 'vote-arena'
    arena.appendChild(renderCard(leftLunch))
    arena.appendChild(renderCard(rightLunch))
    content.appendChild(arena)

    const voteRow = document.createElement('div')
    voteRow.className = 'vote-buttons'

    const leftBtn = document.createElement('button')
    leftBtn.className = 'btn btn-primary'
    leftBtn.textContent = `← ${truncate(leftLunch.name)}`

    const tieBtn = document.createElement('button')
    tieBtn.className = 'btn btn-secondary'
    tieBtn.textContent = 'Tie'

    const rightBtn = document.createElement('button')
    rightBtn.className = 'btn btn-primary'
    rightBtn.textContent = `${truncate(rightLunch.name)} →`

    voteRow.appendChild(leftBtn)
    voteRow.appendChild(tieBtn)
    voteRow.appendChild(rightBtn)
    content.appendChild(voteRow)

    async function castVote(result: 'left_win' | 'right_win' | 'tie'): Promise<void> {
      if (!leftLunch || !rightLunch) return
      ;[leftBtn, tieBtn, rightBtn].forEach((b) => { b.disabled = true })

      // Fade out before replacing the matchup.
      arena.style.transition = 'opacity 0.2s'
      arena.style.opacity = '0'

      try {
        const res = await submitVote(leftLunch.id, rightLunch.id, result)
        await new Promise((r) => setTimeout(r, 200))
        await load(res.next)
      } catch {
        arena.style.opacity = '1'
        ;[leftBtn, tieBtn, rightBtn].forEach((b) => { b.disabled = false })
        const err = document.createElement('p')
        err.style.cssText = 'text-align:center;color:#dc2626;margin-top:12px;font-size:13px;'
        err.textContent = 'Vote failed. Try again.'
        content.appendChild(err)
      }
    }

    leftBtn.addEventListener('click', () => castVote('left_win'))
    tieBtn.addEventListener('click', () => castVote('tie'))
    rightBtn.addEventListener('click', () => castVote('right_win'))
  }

  load(undefined)
}
