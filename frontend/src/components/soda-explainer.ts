/** First-visit "how it works" dialog for SodaArena. Reopened from the header's help button. */

export const SODA_EXPLAINER_KEY = 'lb_soda_explainer_seen'

export type SodaExplainer = { close: () => void }

/** True when this browser has dismissed the explainer before. Storage errors count as seen. */
export function sodaExplainerSeen(): boolean {
  try {
    return localStorage.getItem(SODA_EXPLAINER_KEY) === '1'
  } catch {
    // No storage (private mode, blocked): showing it on every visit would nag, so skip it.
    return true
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SODA_EXPLAINER_KEY, '1')
  } catch {
    // Best effort.
  }
}

const ARROW_LEFT = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>'
const ARROW_RIGHT = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'

/**
 * Opens the explainer. Any way of closing it (button, ×, Escape, backdrop) marks it seen.
 * Focus starts on "Start swiping" and returns to `opener` (or stays on the page) on close.
 */
export function openSodaExplainer(opener: HTMLElement | null, onClose: () => void): SodaExplainer {
  let closed = false
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <section class="soda-report-modal soda-explainer" role="dialog" aria-modal="true" aria-labelledby="soda-explainer-title">
      <div class="soda-report-head">
        <h2 class="soda-report-title" id="soda-explainer-title">How SodaArena works</h2>
        <button type="button" class="modal-close" aria-label="Close">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
        </button>
      </div>
      <ul class="soda-explainer-list">
        <li class="soda-explainer-row soda-explainer-like">
          <span class="soda-explainer-badge">LIKE ${ARROW_RIGHT}</span>
          <span>Swipe right on drinks you want in the fridge.</span>
        </li>
        <li class="soda-explainer-row soda-explainer-dislike">
          <span class="soda-explainer-badge">${ARROW_LEFT} DISLIKE</span>
          <span>Swipe left on ones you don't.</span>
        </li>
        <li class="soda-explainer-row soda-explainer-report">
          <span class="soda-explainer-badge">+ Report</span>
          <span>Tried one? Report it to say you like it or hate it.</span>
        </li>
      </ul>
      <button type="button" class="btn btn-primary soda-explainer-start">Start swiping</button>
    </section>
  `
  const start = backdrop.querySelector<HTMLButtonElement>('.soda-explainer-start')!
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('.modal-close')!

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    // Two focusable controls: keep Tab inside the dialog.
    event.preventDefault()
    const target = document.activeElement === start ? closeBtn : start
    target.focus()
  }

  function close(): void {
    if (closed) return
    closed = true
    markSeen()
    document.removeEventListener('keydown', onDocumentKeydown, true)
    backdrop.remove()
    document.body.style.overflow = ''
    opener?.focus()
    onClose()
  }

  start.addEventListener('click', close)
  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  // Capture phase, like the report modal, so the page's arrow-key swipes never see keys meant here.
  document.addEventListener('keydown', onDocumentKeydown, true)

  document.body.appendChild(backdrop)
  document.body.style.overflow = 'hidden'
  start.focus()
  return { close }
}
