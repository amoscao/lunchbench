const TABS = [
  { label: 'Lunch', path: '/leaderboard' },
  { label: 'Soda', path: '/leaderboard/soda' },
] as const

/** Lunch / Soda switch shown on both leaderboard pages. */
export function createLeaderboardTabs(activePath: string, navigate: (path: string) => void): HTMLElement {
  const tabs = document.createElement('div')
  tabs.className = 'board-tabs'
  tabs.setAttribute('role', 'tablist')
  for (const tab of TABS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `board-tab${tab.path === activePath ? ' active' : ''}`
    button.dataset.path = tab.path
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(tab.path === activePath))
    button.textContent = tab.label
    button.addEventListener('click', () => {
      if (tab.path !== activePath) navigate(tab.path)
    })
    tabs.appendChild(button)
  }
  return tabs
}
