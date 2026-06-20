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

  resolve(): void {
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
