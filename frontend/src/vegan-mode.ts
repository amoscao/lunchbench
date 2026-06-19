export function initVeganMode(onToggle: (isVegan: boolean) => void): void {
  const saved = localStorage.getItem('vegan-mode')
  const isVegan = saved === 'true'
  applyVeganMode(isVegan)

  const btn = document.querySelector<HTMLButtonElement>('.nav-vegan-toggle')
  if (!btn) return

  updateVeganButton(btn, isVegan)

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-vegan') === 'true'
    const next = !current
    applyVeganMode(next)
    localStorage.setItem('vegan-mode', String(next))
    updateVeganButton(btn, next)
    onToggle(next)
  })
}

export function isVeganMode(): boolean {
  return document.documentElement.getAttribute('data-vegan') === 'true'
}

function applyVeganMode(isVegan: boolean): void {
  if (isVegan) {
    document.documentElement.setAttribute('data-vegan', 'true')
  } else {
    document.documentElement.removeAttribute('data-vegan')
  }
}

function updateVeganButton(btn: HTMLButtonElement, isVegan: boolean): void {
  btn.textContent = isVegan ? '🌿 On' : '🌿'
  btn.setAttribute('aria-label', isVegan ? 'Disable vegan mode' : 'Enable vegan mode')
  btn.classList.toggle('active', isVegan)
}
