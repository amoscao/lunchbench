import { getSodaCatalog, getSodaDeck, submitSodaSwipe, type Soda } from '../api'
import { openSodaReportModal, type ReportModal } from '../components/soda-report-modal'
import { escapeHtml } from '../utils/escape-html'
import { swipeDirection, SWIPE_THRESHOLD_PX } from '../utils/soda'

type Direction = 'right' | 'left'

const FLY_OUT_MS = 220

const ARROW_LEFT = '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>'
const ARROW_RIGHT = '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
const PLUS = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function renderSoda(container: HTMLElement): () => void {
  const content = document.createElement('div')
  content.className = 'page-content soda-page'
  content.innerHTML = `
    <div class="soda-header">
      <h1 class="page-heading">Sodabench</h1>
      <button type="button" class="btn btn-primary soda-report-open">${PLUS}Report a soda</button>
    </div>
    <div class="soda-progress">
      <div class="soda-progress-track"><div class="soda-progress-fill"></div></div>
      <span class="soda-progress-label"></span>
    </div>
    <div class="soda-stage">
      <div class="soda-stage-back soda-stage-back-1" aria-hidden="true"></div>
      <div class="soda-stage-back soda-stage-back-2" aria-hidden="true"></div>
      <div class="soda-slot"></div>
    </div>
    <div class="soda-actions">
      <button type="button" class="soda-swipe-btn soda-swipe-left" aria-label="Swipe left">${ARROW_LEFT}</button>
      <button type="button" class="soda-swipe-btn soda-swipe-right" aria-label="Swipe right">${ARROW_RIGHT}</button>
    </div>
  `
  container.appendChild(content)

  const slot = content.querySelector<HTMLElement>('.soda-slot')!
  const progressFill = content.querySelector<HTMLElement>('.soda-progress-fill')!
  const progressLabel = content.querySelector<HTMLElement>('.soda-progress-label')!
  const leftBtn = content.querySelector<HTMLButtonElement>('.soda-swipe-left')!
  const rightBtn = content.querySelector<HTMLButtonElement>('.soda-swipe-right')!
  const reportBtn = content.querySelector<HTMLButtonElement>('.soda-report-open')!

  let deck: Soda[] = []
  let index = 0
  let busy = true
  let destroyed = false
  let catalog: Soda[] = []
  let catalogPromise: Promise<Soda[]> | null = null
  let modal: ReportModal | null = null
  let currentCard: HTMLElement | null = null

  function loadCatalog(): Promise<Soda[]> {
    catalogPromise ??= getSodaCatalog()
      .then((sodas) => {
        catalog = sodas
        return sodas
      })
      .catch((error) => {
        catalogPromise = null
        throw error
      })
    return catalogPromise
  }

  function setProgress(): void {
    const total = deck.length
    const shown = total === 0 ? 0 : Math.min(index + 1, total)
    progressLabel.textContent = `${shown} / ${total}`
    progressFill.style.width = total === 0 ? '0%' : `${Math.round((Math.min(index, total) / total) * 100)}%`
  }

  function setButtons(): void {
    const enabled = !busy && index < deck.length
    leftBtn.disabled = !enabled
    rightBtn.disabled = !enabled
  }

  function preload(soda: Soda | undefined): void {
    if (!soda?.image_url) return
    const img = new Image()
    img.src = soda.image_url
  }

  function renderCard(soda: Soda): HTMLElement {
    const card = document.createElement('article')
    card.className = 'soda-card'
    card.dataset.sodaId = String(soda.id)
    card.innerHTML = `
      <div class="soda-card-stamp" aria-hidden="true">LIKE</div>
      <div class="soda-card-image">
        ${soda.image_url
          ? `<img src="${escapeHtml(soda.image_url)}" alt="${escapeHtml(soda.name)}" draggable="false" />`
          : `<span class="soda-card-initial">${escapeHtml(soda.brand.charAt(0))}</span>`}
      </div>
      <div class="soda-card-info">
        <div class="soda-card-brand">${escapeHtml(soda.brand)}</div>
        <div class="soda-card-flavor">${escapeHtml(soda.flavor)}</div>
      </div>
    `
    attachDrag(card)
    return card
  }

  function renderDone(): HTMLElement {
    const done = document.createElement('div')
    done.className = 'soda-card soda-card-done'
    done.innerHTML = '<div class="soda-done-title">Deck done</div>'
    const restart = document.createElement('button')
    restart.type = 'button'
    restart.className = 'btn btn-secondary soda-restart'
    restart.textContent = 'Start over'
    restart.addEventListener('click', () => void loadDeck())
    done.appendChild(restart)
    return done
  }

  function renderState(icon: string, title: string, retry?: () => void): void {
    currentCard = null
    slot.innerHTML = `
      <div class="soda-card soda-card-done">
        <div class="state-icon">${icon}</div>
        <div class="soda-done-title">${escapeHtml(title)}</div>
      </div>
    `
    if (retry) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn btn-secondary'
      btn.textContent = 'Retry'
      btn.addEventListener('click', retry)
      slot.firstElementChild?.appendChild(btn)
    }
  }

  function show(): void {
    setProgress()
    slot.innerHTML = ''
    if (index >= deck.length) {
      currentCard = null
      slot.appendChild(renderDone())
    } else {
      currentCard = renderCard(deck[index])
      slot.appendChild(currentCard)
      preload(deck[index + 1])
    }
    setButtons()
  }

  async function loadDeck(): Promise<void> {
    busy = true
    setButtons()
    slot.innerHTML = '<div class="skeleton soda-card-skeleton"></div>'
    try {
      const next = await getSodaDeck()
      if (destroyed) return
      deck = next
      index = 0
      busy = false
      if (deck.length === 0) {
        setProgress()
        renderState('🥤', 'No drinks yet')
        setButtons()
        return
      }
      show()
    } catch {
      if (destroyed) return
      busy = false
      renderState('⚠', 'Something went wrong', () => void loadDeck())
      setButtons()
    }
  }

  function swipe(direction: Direction): void {
    const card = currentCard
    if (busy || !card || index >= deck.length) return
    busy = true
    setButtons()
    void submitSodaSwipe(deck[index].id, direction).catch(() => undefined)

    const advance = (): void => {
      if (destroyed) return
      index += 1
      busy = false
      show()
    }
    if (prefersReducedMotion()) {
      advance()
      return
    }
    card.classList.remove('dragging')
    card.classList.add('flying')
    const sign = direction === 'right' ? 1 : -1
    card.style.transform = `translateX(${sign * 140}%) rotate(${sign * 18}deg)`
    card.style.opacity = '0'
    window.setTimeout(advance, FLY_OUT_MS)
  }

  function attachDrag(card: HTMLElement): void {
    const stamp = card.querySelector<HTMLElement>('.soda-card-stamp')!
    let pointerId: number | null = null
    let startX = 0
    let dx = 0

    card.addEventListener('pointerdown', (event) => {
      if (busy || pointerId !== null || event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      dx = 0
      card.setPointerCapture(event.pointerId)
      card.classList.add('dragging')
    })
    card.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return
      dx = event.clientX - startX
      card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`
      stamp.style.opacity = String(Math.max(0, Math.min(1, dx / SWIPE_THRESHOLD_PX)))
    })
    const release = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return
      pointerId = null
      if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId)
      const direction = event.type === 'pointerup' ? swipeDirection(dx) : null
      if (direction) {
        swipe(direction)
        return
      }
      card.classList.remove('dragging')
      card.style.transform = ''
      stamp.style.opacity = ''
    }
    card.addEventListener('pointerup', release)
    card.addEventListener('pointercancel', release)
  }

  // Scoped to this page: added on render, removed by the router cleanup.
  function onKeydown(event: KeyboardEvent): void {
    if (modal || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      swipe('right')
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      swipe('left')
    }
  }

  leftBtn.addEventListener('click', () => swipe('left'))
  rightBtn.addEventListener('click', () => swipe('right'))
  reportBtn.addEventListener('click', async () => {
    if (modal) return
    reportBtn.disabled = true
    try {
      await loadCatalog()
    } catch {
      reportBtn.disabled = false
      return
    }
    reportBtn.disabled = false
    if (destroyed || modal) return
    modal = openSodaReportModal(catalog, () => {
      modal = null
    })
  })
  document.addEventListener('keydown', onKeydown)

  void loadDeck()
  void loadCatalog().catch(() => undefined)

  return () => {
    destroyed = true
    document.removeEventListener('keydown', onKeydown)
    modal?.close()
  }
}
