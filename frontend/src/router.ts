type Route = {
  path: string
  render: (container: HTMLElement) => void | (() => void)
}

export class Router {
  private routes: Route[] = []
  private container: HTMLElement
  private currentCleanup: (() => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    window.addEventListener('popstate', () => this.resolve())
  }

  add(path: string, render: (container: HTMLElement) => void | (() => void)): this {
    this.routes.push({ path, render })
    return this
  }

  navigate(path: string): void {
    history.pushState(null, '', path)
    this.resolve()
  }

  async resolve(): Promise<void> {
    const path = window.location.pathname
    const route = this.routes.find((r) => r.path === path) ?? this.routes.find((r) => r.path === '/')
    if (route) {
      if (this.currentCleanup) {
        this.currentCleanup()
        this.currentCleanup = null
      }
      this.container.innerHTML = ''
      const cleanup = route.render(this.container)
      if (typeof cleanup === 'function') {
        this.currentCleanup = cleanup
      }
      this.updateNavLinks()
      return
    }

    const lunchMatch = path.match(/^\/lunch\/(\d+)$/)
    if (lunchMatch) {
      const { renderLunchDetail } = await import('./pages/lunch-detail')
      if (this.currentCleanup) {
        this.currentCleanup()
        this.currentCleanup = null
      }
      this.container.innerHTML = ''
      const cleanup = renderLunchDetail(this.container, (target) => this.navigate(target), Number(lunchMatch[1]))
      if (typeof cleanup === 'function') {
        this.currentCleanup = cleanup
      } else {
        this.currentCleanup = null
      }
      this.updateNavLinks()
      return
    }
    this.updateNavLinks()
  }

  private updateNavLinks(): void {
    const path = window.location.pathname
    document.querySelectorAll('.nav-link').forEach((el) => {
      const link = el as HTMLElement
      const href = link.dataset.path ?? '/'
      link.classList.toggle('active', path === href || (href !== '/' && path.startsWith(href)))
    })
  }
}
