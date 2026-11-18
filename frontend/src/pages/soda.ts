import { getSodaCatalog, getSodaDeck, isSodaBannedError, submitSodaSwipe, type Soda } from '../api'
import { openSodaExplainer, sodaExplainerSeen, type SodaExplainer } from '../components/soda-explainer'
import { openSodaReportModal, type ReportModal } from '../components/soda-report-modal'
import { SwipeStack } from '../components/swipe-stack'
import { escapeHtml } from '../utils/escape-html'
import type { Direction } from '../utils/swipe-physics'

const ARROW_LEFT = '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>'
const ARROW_RIGHT = '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
const HELP = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'
const PLUS = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'

/** A card for one drink. The image element arrives preloaded from the stack. */
function renderSodaCard(soda: Soda, image: HTMLImageElement | null): HTMLElement {
  const card = document.createElement('article')
  card.className = 'soda-card'
  card.dataset.sodaId = String(soda.id)
  card.setAttribute('aria-label', soda.name)
  card.innerHTML = `
    <div class="soda-tint soda-tint-like" aria-hidden="true"></div>
    <div class="soda-tint soda-tint-nope" aria-hidden="true"></div>
    <div class="soda-stamp soda-stamp-like" aria-hidden="true">LIKE</div>
    <div class="soda-stamp soda-stamp-nope" aria-hidden="true">DISLIKE</div>
    <div class="soda-card-image">
      ${image ? '' : `<span class="soda-card-initial">${escapeHtml(soda.brand.charAt(0))}</span>`}
    </div>
    <div class="soda-card-info">
      <div class="soda-card-brand">${escapeHtml(soda.brand)}</div>
      <div class="soda-card-flavor">${escapeHtml(soda.flavor)}</div>
    </div>
  `
  if (image) {
    image.alt = soda.name
    card.querySelector('.soda-card-image')!.appendChild(image)
  }
  return card
}

/** SodaArena: one continuous swipe feed of every drink this voter has not swiped yet. */
export function renderSoda(container: HTMLElement): () => void {
  const content = document.createElement('div')
  content.className = 'page-content soda-page'
  content.innerHTML = `
    <div class="soda-header">
      <h1 class="page-heading">SodaArena</h1>
      <div class="soda-header-actions">
        <button type="button" class="soda-help-open" aria-label="How SodaArena works">${HELP}</button>
        <button type="button" class="btn btn-primary soda-report-open">${PLUS}Report a soda</button>
      </div>
    </div>
    <div class="alert alert-error soda-alert" role="alert" hidden>Swipe not saved</div>
    <div class="visually-hidden soda-announce" aria-live="polite" aria-atomic="true"></div>
    <div class="soda-stage">
      <div class="soda-feed"></div>
      <div class="soda-card-skeleton skeleton"></div>
    </div>
    <div class="soda-actions">
      <button type="button" class="soda-swipe-btn soda-swipe-left" aria-label="Swipe left" disabled>${ARROW_LEFT}</button>
      <button type="button" class="soda-swipe-btn soda-swipe-right" aria-label="Swipe right" disabled>${ARROW_RIGHT}</button>
    </div>
  `
  container.appendChild(content)
  // Flung cards travel past the viewport edge; clip so no horizontal scrollbar flashes.
  document.body.classList.add('soda-route')

  const stage = content.querySelector<HTMLElement>('.soda-stage')!
  const feed = content.querySelector<HTMLElement>('.soda-feed')!
  const leftBtn = content.querySelector<HTMLButtonElement>('.soda-swipe-left')!
  const rightBtn = content.querySelector<HTMLButtonElement>('.soda-swipe-right')!
  const reportBtn = content.querySelector<HTMLButtonElement>('.soda-report-open')!
  const helpBtn = content.querySelector<HTMLButtonElement>('.soda-help-open')!
  const alertEl = content.querySelector<HTMLElement>('.soda-alert')!
  const announcer = content.querySelector<HTMLElement>('.soda-announce')!

  let destroyed = false
  let catalog: Soda[] = []
  let catalogPromise: Promise<Soda[]> | null = null
  let modal: ReportModal | null = null
  let explainer: SodaExplainer | null = null

  function setButtons(enabled: boolean): void {
    leftBtn.disabled = !enabled
    rightBtn.disabled = !enabled
  }

  function showState(title: string, icon?: string, retry?: () => void): HTMLElement {
    stage.querySelector('.soda-end')?.remove()
    const state = document.createElement('div')
    state.className = 'soda-end'
    state.setAttribute('role', 'status')
    state.innerHTML = `${icon ? `<div class="state-icon">${icon}</div>` : ''}<div class="soda-end-title" tabindex="-1">${escapeHtml(title)}</div>`
    if (retry) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn btn-secondary'
      btn.textContent = 'Retry'
      btn.addEventListener('click', retry)
      state.appendChild(btn)
    }
    stage.appendChild(state)
    return state
  }

  /** End of the feed. An empty catalog says so instead of claiming everything is rated. */
  async function showEnd(): Promise<void> {
    const focusWasHere = content.contains(document.activeElement) || document.activeElement === document.body
    setButtons(false)
    let catalogEmpty = false
    try {
      catalogEmpty = (await loadCatalog()).length === 0
    } catch {
      // Unknown: assume the voter rated everything.
    }
    if (destroyed) return
    const title = catalogEmpty ? 'No drinks yet' : "You've rated everything"
    // Announced even when focus is elsewhere (the status card is also role="status").
    announcer.textContent = title
    const state = showState(title)
    // The swipe buttons just got disabled; keep focus on the page instead of letting it fall to body.
    if (focusWasHere) state.querySelector<HTMLElement>('.soda-end-title')?.focus()
  }

  // Retries once. A final failure shows the error alert; the next saved swipe clears it.
  async function recordSwipe(sodaId: number, direction: Direction): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await submitSodaSwipe(sodaId, direction)
        if (!destroyed) alertEl.hidden = true
        return
      } catch (e: unknown) {
        // The drink was banned after the feed loaded: there is nothing to save, so the card is done.
        if (isSodaBannedError(e)) return
        // Otherwise retry once below.
      }
    }
    if (!destroyed) alertEl.hidden = false
  }

  const stack = new SwipeStack<Soda>({
    container: feed,
    imageUrl: (soda) => soda.image_url,
    renderCard: renderSodaCard,
    onSwipe: (soda, direction) => void recordSwipe(soda.id, direction),
    onEmpty: () => void showEnd(),
    onTop: (soda) => {
      announcer.textContent = soda.name
    },
  })

  async function loadFeed(): Promise<void> {
    stage.querySelector('.soda-end')?.remove()
    try {
      const sodas = await getSodaDeck()
      if (destroyed) return
      stage.querySelector('.soda-card-skeleton')?.remove()
      setButtons(sodas.length > 0)
      stack.setItems(sodas)
    } catch {
      if (destroyed) return
      stage.querySelector('.soda-card-skeleton')?.remove()
      showState('Something went wrong', '⚠', () => void loadFeed())
    }
  }

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

  // Scoped to this page: added on render, removed by the router cleanup.
  function onKeydown(event: KeyboardEvent): void {
    if (modal || explainer || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    // Holding an arrow key auto-repeats; one press is one vote.
    if (event.repeat && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      stack.swipe('right')
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stack.swipe('left')
    }
  }

  leftBtn.addEventListener('click', () => stack.swipe('left'))
  rightBtn.addEventListener('click', () => stack.swipe('right'))
  // A flag, not `disabled`: disabling the focused button would drop focus before the modal records its opener.
  let opening = false
  reportBtn.addEventListener('click', async () => {
    if (modal || explainer || opening) return
    opening = true
    try {
      await loadCatalog()
    } catch {
      return
    } finally {
      opening = false
    }
    if (destroyed || modal) return
    modal = openSodaReportModal(catalog, reportBtn, () => {
      modal = null
    })
  })
  function showExplainer(opener: HTMLElement | null): void {
    if (explainer || modal) return
    explainer = openSodaExplainer(opener, () => {
      explainer = null
    })
  }
  helpBtn.addEventListener('click', () => showExplainer(helpBtn))
  document.addEventListener('keydown', onKeydown)

  void loadFeed()
  // First visit in this browser: explain the swipe directions before the first card.
  if (!sodaExplainerSeen()) showExplainer(null)
  void loadCatalog().catch(() => undefined)

  return () => {
    destroyed = true
    document.body.classList.remove('soda-route')
    stack.destroy()
    document.removeEventListener('keydown', onKeydown)
    modal?.close()
    explainer?.close()
  }
}
