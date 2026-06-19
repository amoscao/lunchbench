type Route = {
  path: string
  render: (container: HTMLElement) => void
}

export class Router {
  private routes: Route[] = []
  private container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    window.addEventListener('popstate', () => this.resolve())
  }

  add(path: string, render: (container: HTMLElement) => void): this {
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
      this.container.innerHTML = ''
      route.render(this.container)
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
