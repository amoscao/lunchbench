export function createNav(navigate: (path: string) => void): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'nav'
  nav.innerHTML = `
    <span class="nav-logo">Lunchbench</span>
    <div class="nav-links">
      <span class="nav-link" data-path="/">Home</span>
      <span class="nav-link" data-path="/leaderboard">Leaderboard</span>
      <span class="nav-link" data-path="/add">Add Lunch</span>
    </div>
    <button class="nav-theme-toggle" aria-label="Toggle theme">☾</button>
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
