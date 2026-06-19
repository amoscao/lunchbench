import './styles/main.css'
import { Router } from './router'
import { createNav } from './components/nav'
import { initTheme } from './theme'
import { renderHome } from './pages/home'
import { renderLeaderboard } from './pages/leaderboard'
import { renderAdd } from './pages/add'

const appEl = document.getElementById('app')!
appEl.style.display = 'flex'
appEl.style.flexDirection = 'column'
appEl.style.minHeight = '100vh'

// Persistent nav
const mainEl = document.createElement('main')
mainEl.style.flex = '1'
appEl.appendChild(mainEl)

const router = new Router(mainEl)

// Nav inserted after router is created so navigate() is available
const nav = createNav((path) => router.navigate(path))
appEl.insertBefore(nav, mainEl)

router
  .add('/', (c) => renderHome(c, (path) => router.navigate(path)))
  .add('/leaderboard', (c) => renderLeaderboard(c, (path) => router.navigate(path)))
  .add('/add', (c) => renderAdd(c))

initTheme()
router.resolve()
