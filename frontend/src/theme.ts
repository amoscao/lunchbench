export function initTheme(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.nav-theme-toggle')
  if (!toggle) return

  function getTheme(): string {
    return document.documentElement.getAttribute('data-theme') ?? 'light'
  }

  function setTheme(theme: string): void {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
    updateIcon()
  }

  function updateIcon(): void {
    toggle!.textContent = getTheme() === 'dark' ? '☀' : '☾'
    toggle!.setAttribute('aria-label', `Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} mode`)
  }

  toggle.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  })

  updateIcon()
}
