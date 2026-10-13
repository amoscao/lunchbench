import { isVeganToggleDisabled } from '../vegan-mode'

export function createNav(navigate: (path: string) => void): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'nav'
  const veganToggle = isVeganToggleDisabled()
    ? ''
    : '<button class="nav-vegan-toggle" aria-label="Enable vegan mode">🌿</button>'
  nav.innerHTML = `
    <span class="nav-logo">🥪 <span class="nav-logo-text"><span class="logo-lunch">Lunch</span><span class="logo-bench">Bench</span></span></span>
    <div class="nav-links">
      <span class="nav-link" data-path="/">Arena</span>
      <span class="nav-link" data-path="/leaderboard">Leaderboard</span>
    </div>
    <div class="nav-actions">
      ${veganToggle}
      <button class="nav-theme-toggle" aria-label="Toggle theme">☾</button>
    </div>
  `

  nav.querySelectorAll('.nav-link').forEach((el) => {
    el.addEventListener('click', () => {
      const path = (el as HTMLElement).dataset.path ?? '/'
      navigate(path)
    })
  })

  nav.querySelector('.nav-logo')!.addEventListener('click', () => navigate('/'))

  return nav
}
