import {
  commitDirection,
  dragProgress,
  flingOpacity,
  planFling,
  rotationFor,
  springSettled,
  springStep,
  SWIPE,
  underCardTransform,
  VelocityTracker,
  type Direction,
  type SpringState,
} from '../utils/swipe-physics'

/** Cards rendered at once: the top card plus two underneath. */
const STACK_DEPTH = 3
/** Images decoded ahead of the rendered stack. */
const PRELOAD_AHEAD = 4
/** How long the promoted cards animate into their new depth (matches .settling in CSS). */
const SETTLE_MS = 240

export type SwipeStackOptions<T> = {
  container: HTMLElement
  imageUrl: (item: T) => string | null
  /** Builds a card. `image` is an already-decoding <img> for the item, or null. */
  renderCard: (item: T, image: HTMLImageElement | null) => HTMLElement
  onSwipe: (item: T, direction: Direction) => void
  onEmpty: () => void
  /** Called whenever a new card becomes the top card (for a screen-reader announcement). */
  onTop?: (item: T) => void
}

type Card<T> = {
  item: T
  el: HTMLElement
  likeStamp: HTMLElement | null
  nopeStamp: HTMLElement | null
  likeTint: HTMLElement | null
  nopeTint: HTMLElement | null
}

type Pose = { x: number; y: number; rotation: number }

type Drag = {
  pointerId: number
  card: HTMLElement
  startX: number
  startY: number
  grabbedTopHalf: boolean
  pose: Pose
  tracker: VelocityTracker
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

const ZERO_POSE: Pose = { x: 0, y: 0, rotation: 0 }

/**
 * Tinder-style card stack. The top card follows the pointer; released cards fling out with their
 * momentum or spring back. Cards underneath are fully rendered with preloaded images, so promoting
 * the next card never flashes an empty card.
 */
export class SwipeStack<T> {
  private queue: T[] = []
  private cards: Array<Card<T>> = []
  private preloaded = new Map<string, HTMLImageElement>()
  private drag: Drag | null = null
  private frame = 0
  private springFrame = 0
  private destroyed = false
  /** Last painted pose of each top or flying card. */
  private poses = new WeakMap<HTMLElement, Pose>()

  constructor(private readonly options: SwipeStackOptions<T>) {
    options.container.addEventListener('pointerdown', this.onPointerDown)
    options.container.addEventListener('pointermove', this.onPointerMove)
    options.container.addEventListener('pointerup', this.onPointerUp)
    options.container.addEventListener('pointercancel', this.onPointerCancel)
    options.container.addEventListener('lostpointercapture', this.onPointerCancel)
  }

  setItems(items: T[]): void {
    for (const card of this.cards) card.el.remove()
    this.cards = []
    this.queue = [...items]
    this.fill()
    this.layout(0)
    if (this.cards.length === 0) this.options.onEmpty()
    else this.options.onTop?.(this.cards[0].item)
  }

  get top(): T | null {
    return this.cards[0]?.item ?? null
  }

  /** Programmatic swipe (buttons, arrow keys): the same fling, with a default velocity. */
  swipe(direction: Direction): void {
    const top = this.cards[0]
    if (!top || this.drag) return
    this.stopSpring()
    const sign = direction === 'right' ? 1 : -1
    this.fling(top, direction, {
      pose: this.currentPose(top.el),
      vx: sign * SWIPE.buttonVelocityX,
      vy: SWIPE.buttonVelocityY,
    })
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.springFrame)
    const container = this.options.container
    container.removeEventListener('pointerdown', this.onPointerDown)
    container.removeEventListener('pointermove', this.onPointerMove)
    container.removeEventListener('pointerup', this.onPointerUp)
    container.removeEventListener('pointercancel', this.onPointerCancel)
    container.removeEventListener('lostpointercapture', this.onPointerCancel)
  }

  // ---- Stack building ----

  private imageFor(item: T): HTMLImageElement | null {
    const url = this.options.imageUrl(item)
    if (!url) return null
    let img = this.preloaded.get(url)
    if (!img) {
      img = new Image()
      img.decoding = 'async'
      img.draggable = false
      img.src = url
      img.decode().catch(() => undefined)
      this.preloaded.set(url, img)
    }
    return img
  }

  /** Renders cards until the stack is full, and decodes images further ahead. */
  private fill(): void {
    while (this.cards.length < STACK_DEPTH && this.queue.length > 0) {
      const item = this.queue.shift()!
      const image = this.imageFor(item)
      const url = this.options.imageUrl(item)
      if (url) this.preloaded.delete(url)
      const el = this.options.renderCard(item, image)
      el.classList.add('swipe-card')
      // Append underneath: the container's first card is the top.
      this.options.container.appendChild(el)
      this.cards.push({
        item,
        el,
        likeStamp: el.querySelector<HTMLElement>('.soda-stamp-like'),
        nopeStamp: el.querySelector<HTMLElement>('.soda-stamp-nope'),
        likeTint: el.querySelector<HTMLElement>('.soda-tint-like'),
        nopeTint: el.querySelector<HTMLElement>('.soda-tint-nope'),
      })
    }
    for (const item of this.queue.slice(0, PRELOAD_AHEAD)) this.imageFor(item)
  }

  /** Places every card by depth. `progress` is the top card's drag progress (0-1). */
  private layout(progress: number): void {
    this.cards.forEach((card, depth) => {
      card.el.dataset.depth = String(depth)
      card.el.style.zIndex = String(30 - depth * 10)
      card.el.setAttribute('aria-hidden', depth === 0 ? 'false' : 'true')
      if (depth === 0) return
      const { scale, drop } = underCardTransform(depth, Math.min(progress, 1))
      card.el.style.transform = `translate3d(0, ${drop}px, 0) scale(${scale})`
    })
  }

  private currentPose(el: HTMLElement): Pose {
    return this.poses.get(el) ?? ZERO_POSE
  }

  private setPose(el: HTMLElement, pose: Pose): void {
    this.poses.set(el, pose)
    el.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rotation}deg)`
  }

  private resetPose(el: HTMLElement): void {
    this.poses.delete(el)
    el.style.removeProperty('transform')
  }

  private paintTop(card: Card<T>, pose: Pose): void {
    this.setPose(card.el, pose)
    const width = card.el.offsetWidth || 1
    const progress = dragProgress(pose.x, width)
    const tilt = 4 * progress
    if (card.likeStamp) {
      card.likeStamp.style.opacity = pose.x > 0 ? String(progress) : '0'
      card.likeStamp.style.transform = `rotate(${-12 - tilt}deg) scale(${0.9 + 0.1 * progress})`
    }
    if (card.nopeStamp) {
      card.nopeStamp.style.opacity = pose.x < 0 ? String(progress) : '0'
      card.nopeStamp.style.transform = `rotate(${12 + tilt}deg) scale(${0.9 + 0.1 * progress})`
    }
    // The colour wash fades in with its stamp. Both are children of the card, so they move with it.
    if (card.likeTint) card.likeTint.style.opacity = pose.x > 0 ? String(progress) : '0'
    if (card.nopeTint) card.nopeTint.style.opacity = pose.x < 0 ? String(progress) : '0'
    // Reduced motion: the cards underneath stay put instead of scaling with the drag.
    this.layout(reducedMotion() ? 0 : progress)
  }

  // ---- Pointer input ----

  private onPointerDown = (event: PointerEvent): void => {
    const top = this.cards[0]
    if (!top || this.drag || event.button !== 0) return
    if (!top.el.contains(event.target as Node)) return
    this.stopSpring()
    top.el.classList.remove('settling')
    const rect = top.el.getBoundingClientRect()
    const pose = this.currentPose(top.el)
    const tracker = new VelocityTracker()
    const now = performance.now()
    tracker.reset(now, pose.x, pose.y)
    this.drag = {
      pointerId: event.pointerId,
      card: top.el,
      startX: event.clientX - pose.x,
      startY: event.clientY - pose.y,
      grabbedTopHalf: event.clientY - rect.top < rect.height / 2,
      pose,
      tracker,
    }
    top.el.setPointerCapture(event.pointerId)
    top.el.classList.add('dragging')
  }

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointerId) return
    // The mouse button came up somewhere we never heard about: end the drag instead of sticking.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      this.onPointerCancel(event)
      return
    }
    const x = event.clientX - drag.startX
    const y = event.clientY - drag.startY
    drag.pose = { x, y, rotation: rotationFor(x, drag.grabbedTopHalf) }
    drag.tracker.add(performance.now(), x, y)
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        const top = this.cards[0]
        if (this.drag && top && top.el === this.drag.card) this.paintTop(top, this.drag.pose)
      })
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointerId) return
    this.endDrag(drag, event)
    const top = this.cards[0]
    if (!top || top.el !== drag.card) return
    const { vx, vy } = drag.tracker.velocity(performance.now())
    const direction = commitDirection(drag.pose.x, vx, top.el.offsetWidth)
    if (direction) this.fling(top, direction, { pose: drag.pose, vx, vy })
    else this.springBack(top, drag.pose, vx, vy)
  }

  private onPointerCancel = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointerId) return
    this.endDrag(drag, event)
    const top = this.cards[0]
    if (top && top.el === drag.card) this.springBack(top, drag.pose, 0, 0)
  }

  private endDrag(drag: Drag, event: PointerEvent): void {
    this.drag = null
    cancelAnimationFrame(this.frame)
    this.frame = 0
    drag.card.classList.remove('dragging')
    if (drag.card.hasPointerCapture(event.pointerId)) drag.card.releasePointerCapture(event.pointerId)
  }

  // ---- Animations ----

  private fling(card: Card<T>, direction: Direction, release: { pose: Pose; vx: number; vy: number }): void {
    // Promote at once: the next card is draggable while this one is still flying.
    this.cards.shift()
    card.el.classList.add('leaving')
    card.el.classList.remove('settling')
    card.el.style.zIndex = '40'
    card.el.dataset.depth = 'leaving'
    card.el.setAttribute('aria-hidden', 'true')
    this.fill()
    const settling = this.cards.map((next) => next.el)
    for (const el of settling) el.classList.add('settling')
    window.setTimeout(() => settling.forEach((el) => el.classList.remove('settling')), SETTLE_MS)
    this.layout(0)
    if (this.cards[0]) this.resetPose(this.cards[0].el)
    this.options.onSwipe(card.item, direction)
    if (this.cards.length === 0) this.options.onEmpty()
    else this.options.onTop?.(this.cards[0].item)

    if (reducedMotion()) {
      card.el.classList.add('fading')
      window.setTimeout(() => card.el.remove(), 150)
      return
    }

    const stamp = direction === 'right' ? card.likeStamp : card.nopeStamp
    if (stamp) stamp.style.opacity = '1'
    const tint = direction === 'right' ? card.likeTint : card.nopeTint
    if (tint) tint.style.opacity = '1'
    const plan = planFling({
      direction,
      dx: release.pose.x,
      dy: release.pose.y,
      rotation: release.pose.rotation,
      vx: release.vx,
      vy: release.vy,
      cardWidth: card.el.offsetWidth,
    })
    const from = release.pose
    const start = performance.now()
    const step = (now: number): void => {
      // Constant velocity: the card leaves at the speed the hand released it.
      // rAF timestamps can precede `start` by a fraction of a frame; never step backwards.
      const t = Math.min(1, Math.max(0, (now - start) / plan.durationMs))
      const e = t
      this.setPose(card.el, {
        x: from.x + (plan.toX - from.x) * e,
        y: from.y + (plan.toY - from.y) * e,
        rotation: from.rotation + (plan.toRotation - from.rotation) * e,
      })
      card.el.style.opacity = String(flingOpacity(t))
      if (t < 1 && !this.destroyed) requestAnimationFrame(step)
      else card.el.remove()
    }
    requestAnimationFrame(step)
  }

  private springBack(card: Card<T>, pose: Pose, vx: number, vy: number): void {
    if (reducedMotion()) {
      this.paintTop(card, ZERO_POSE)
      this.resetPose(card.el)
      return
    }
    // Velocities in px/ms from the tracker; the spring works per second.
    let x: SpringState = { position: pose.x, velocity: vx * 1000 }
    let y: SpringState = { position: pose.y, velocity: vy * 1000 }
    const rotationPerPx = pose.x === 0 ? 0 : pose.rotation / pose.x
    let last = performance.now()
    const step = (now: number): void => {
      const dt = Math.min(now - last, 48)
      last = now
      x = springStep(x, dt)
      y = springStep(y, dt)
      if (springSettled(x) && springSettled(y)) {
        this.springFrame = 0
        this.paintTop(card, ZERO_POSE)
        this.resetPose(card.el)
        return
      }
      this.paintTop(card, { x: x.position, y: y.position, rotation: x.position * rotationPerPx })
      this.springFrame = requestAnimationFrame(step)
    }
    this.springFrame = requestAnimationFrame(step)
  }

  private stopSpring(): void {
    if (this.springFrame) cancelAnimationFrame(this.springFrame)
    this.springFrame = 0
  }
}
