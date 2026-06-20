export function animateCountUp(
  el: HTMLElement,
  target: number,
  format: (v: number) => string,
  duration = 900,
): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(target)
    return
  }

  const start = performance.now()
  const step = (time: number) => {
    const progress = Math.min((time - start) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 4)
    el.textContent = format(Math.round(target * eased))
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
