import { submitSodaReport, type Soda } from '../api'
import { fuzzyFilter } from '../fuzzy'
import { escapeHtml } from '../utils/escape-html'
import { rememberBarcode } from '../utils/barcode'
import { cameraSupported, mountScanPanel, prefersScanMode, type ScanPanel, type UnknownScan } from './barcode-scanner'

const MAX_SUGGESTIONS = 6

export type ReportModal = { close: () => void }

const CAMERA_ICON = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8"/><path d="M10 8v8"/><path d="M13 8v8"/><path d="M17 8v8"/></svg>'

/**
 * Report a soda: type-ahead over the catalog, then Like or Hate.
 * Like and Hate stay disabled until a drink is picked. A successful submit closes the modal.
 * On touch devices it opens in scan mode (barcode-scanner.ts); "Select manually" switches to the search.
 */
export function openSodaReportModal(catalog: Soda[], opener: HTMLElement | null, onClose: () => void): ReportModal {
  const byId = new Map(catalog.map((soda) => [soda.id, soda]))
  let picked: Soda | null = null
  let suggestions: Soda[] = []
  let highlighted = -1
  let submitting = false
  let closed = false

  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <section class="soda-report-modal" role="dialog" aria-modal="true" aria-labelledby="soda-report-title">
      <div class="soda-report-head">
        <h2 class="soda-report-title" id="soda-report-title">Report a soda</h2>
        <button type="button" class="modal-close soda-report-scan-open" aria-label="Scan barcode" hidden>${CAMERA_ICON}</button>
        <button type="button" class="modal-close" aria-label="Close">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="soda-report-scan" hidden></div>
      <div class="soda-report-search">
        <input class="form-input soda-report-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="Soda or seltzer" aria-label="Soda or seltzer"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="soda-report-suggestions" />
        <ul class="soda-suggest" id="soda-report-suggestions" role="listbox" hidden></ul>
      </div>
      <div class="alert alert-error soda-report-error" hidden>Report failed</div>
      <div class="soda-report-actions">
        <button type="button" class="btn btn-primary soda-report-like" disabled>Like</button>
        <button type="button" class="btn soda-report-hate" disabled>Hate</button>
      </div>
    </section>
  `
  const modal = backdrop.querySelector<HTMLElement>('.soda-report-modal')!
  const input = backdrop.querySelector<HTMLInputElement>('.soda-report-input')!
  const list = backdrop.querySelector<HTMLUListElement>('.soda-suggest')!
  const error = backdrop.querySelector<HTMLElement>('.soda-report-error')!
  const likeBtn = backdrop.querySelector<HTMLButtonElement>('.soda-report-like')!
  const hateBtn = backdrop.querySelector<HTMLButtonElement>('.soda-report-hate')!
  const search = backdrop.querySelector<HTMLElement>('.soda-report-search')!
  const scanSlot = backdrop.querySelector<HTMLElement>('.soda-report-scan')!
  const scanOpenBtn = backdrop.querySelector<HTMLButtonElement>('.soda-report-scan-open')!
  let scanPanel: ScanPanel | null = null
  // An unknown scanned code, sent with the manual report so the server can learn the mapping.
  let unknownScan: UnknownScan | null = null
  let cameraFailed = false

  function enterScanMode(): void {
    picked = null
    unknownScan = null
    input.value = ''
    hideSuggestions()
    error.hidden = true
    setButtons()
    search.hidden = true
    scanOpenBtn.hidden = true
    scanSlot.hidden = false
    scanPanel = mountScanPanel(scanSlot, catalog, {
      onMatch: (soda) => {
        picked = soda
        setButtons()
      },
      onManual: (unknown) => enterManualMode(unknown),
      onUnavailable: (retryable) => {
        if (!retryable) cameraFailed = true
        enterManualMode(null)
      },
    })
  }

  function enterManualMode(unknown: UnknownScan | null): void {
    scanPanel?.stop()
    scanPanel = null
    scanSlot.hidden = true
    scanSlot.innerHTML = ''
    search.hidden = false
    scanOpenBtn.hidden = cameraFailed || !cameraSupported()
    picked = null
    unknownScan = unknown
    setButtons()
    if (!closed) input.focus()
  }

  function setButtons(): void {
    const enabled = picked !== null && !submitting
    likeBtn.disabled = !enabled
    hateBtn.disabled = !enabled
  }

  function hideSuggestions(): void {
    suggestions = []
    highlighted = -1
    list.hidden = true
    list.innerHTML = ''
    input.setAttribute('aria-expanded', 'false')
  }

  function renderSuggestions(): void {
    const query = input.value.trim()
    if (!query) {
      hideSuggestions()
      return
    }
    suggestions = fuzzyFilter(query, catalog)
      .slice(0, MAX_SUGGESTIONS)
      .map((match) => byId.get(match.id))
      .filter((soda): soda is Soda => soda !== undefined)
    highlighted = suggestions.length > 0 ? 0 : -1
    list.innerHTML = suggestions.map((soda, index) => `
      <li role="option" aria-selected="${index === highlighted}">
        <button type="button" class="soda-suggest-item${index === highlighted ? ' selected' : ''}" data-id="${soda.id}" tabindex="-1">
          ${soda.image_url ? `<img src="${escapeHtml(soda.image_url)}" alt="" />` : '<span class="soda-suggest-noimg"></span>'}
          <span>${escapeHtml(soda.name)}</span>
        </button>
      </li>
    `).join('')
    list.hidden = suggestions.length === 0
    input.setAttribute('aria-expanded', String(suggestions.length > 0))
  }

  function moveHighlight(step: number): void {
    if (suggestions.length === 0) return
    highlighted = (highlighted + step + suggestions.length) % suggestions.length
    list.querySelectorAll('.soda-suggest-item').forEach((item, index) => {
      item.classList.toggle('selected', index === highlighted)
      item.parentElement?.setAttribute('aria-selected', String(index === highlighted))
    })
  }

  function pick(soda: Soda): void {
    picked = soda
    input.value = soda.name
    hideSuggestions()
    setButtons()
  }

  async function submit(verdict: 'like' | 'hate'): Promise<void> {
    if (!picked || submitting) return
    submitting = true
    error.hidden = true
    setButtons()
    try {
      const barcode = unknownScan?.code
      // The server only learns the code if its unknown-scan row exists, so let that request land first.
      if (unknownScan) await unknownScan.logged
      const result = await submitSodaReport(picked.id, verdict, barcode)
      if (barcode && typeof result.barcode_soda_id === 'number') rememberBarcode(barcode, result.barcode_soda_id)
      close()
    } catch {
      submitting = false
      error.hidden = false
      setButtons()
    }
  }

  function focusable(): HTMLElement[] {
    return [...modal.querySelectorAll<HTMLElement>('input, button:not([disabled]):not([tabindex="-1"])')]
      .filter((item) => !item.closest('[hidden]'))
  }

  // Document-level while open: Escape closes from anywhere, Tab cycles inside the dialog.
  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusable()
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    const inside = active instanceof HTMLElement && modal.contains(active)
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault()
      first.focus()
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.target !== input) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveHighlight(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight(-1)
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault()
      pick(suggestions[highlighted])
    }
  }

  function close(): void {
    if (closed) return
    closed = true
    scanPanel?.stop()
    scanPanel = null
    document.removeEventListener('keydown', onDocumentKeydown, true)
    backdrop.remove()
    document.body.style.overflow = ''
    opener?.focus()
    onClose()
  }

  input.addEventListener('input', () => {
    picked = null
    error.hidden = true
    setButtons()
    renderSuggestions()
  })
  list.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('.soda-suggest-item')
    const soda = item ? byId.get(Number(item.dataset.id)) : undefined
    if (soda) pick(soda)
  })
  likeBtn.addEventListener('click', () => void submit('like'))
  hateBtn.addEventListener('click', () => void submit('hate'))
  backdrop.querySelector('.modal-close:not(.soda-report-scan-open)')!.addEventListener('click', close)
  scanOpenBtn.addEventListener('click', enterScanMode)
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })
  modal.addEventListener('keydown', onKeydown)
  document.addEventListener('keydown', onDocumentKeydown, true)

  document.body.appendChild(backdrop)
  document.body.style.overflow = 'hidden'
  if (prefersScanMode()) {
    enterScanMode()
    modal.querySelector<HTMLElement>('.barcode-scan-manual')?.focus()
  } else {
    enterManualMode(null)
  }

  return { close }
}
