// Pure swipe math for the SodaArena card stack. No DOM; unit-tested.

export type Direction = 'right' | 'left'

export const SWIPE = {
  /** Card rotation per px of horizontal drag. */
  rotationPerPx: 0.07,
  /** Rotation cap, degrees. */
  maxRotation: 20,
  /** Commit when the card is dragged past this share of its width. */
  commitFraction: 0.35,
  /** Or when released faster than this (px/ms) in the drag direction. */
  flickVelocity: 0.5,
  /** Release velocity is measured over the last this-many ms of moves. */
  velocityWindowMs: 100,
  /** Fling duration bounds. Inside them the card exits at exactly the release speed. */
  minFlingMs: 100,
  maxFlingMs: 600,
  /** Slowest exit speed, px/ms, so a barely-past-threshold release still leaves briskly. */
  minFlingSpeed: 1.2,
  /** Cap on vertical drift during a fling, px. */
  maxFlingDriftY: 260,
  /** Extra spin added over a fling, degrees. */
  flingSpin: 12,
  /** Buttons and arrow keys fling with this velocity, px/ms: sideways with a slight upward arc. */
  buttonVelocityX: 1.6,
  buttonVelocityY: -0.35,
  /** The card under the top one waits at this scale and drop (px). */
  nextScale: 0.95,
  nextDrop: 10,
  /** Spring for snap-back, per second: under-damped for a slight overshoot. */
  springStiffness: 320,
  springDamping: 24,
} as const

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Rotation follows the horizontal offset. Grabbing the bottom half flips the sign, so the card
 * pivots as if held by that edge (as Tinder does).
 */
export function rotationFor(dx: number, grabbedTopHalf: boolean): number {
  const sign = grabbedTopHalf ? 1 : -1
  return clamp(dx * SWIPE.rotationPerPx * sign, -SWIPE.maxRotation, SWIPE.maxRotation)
}

type Sample = { t: number; x: number; y: number }

/** Release velocity from the last ~100 ms of pointer samples. */
export class VelocityTracker {
  private samples: Sample[] = []

  reset(t: number, x: number, y: number): void {
    this.samples = [{ t, x, y }]
  }

  add(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y })
    const cutoff = t - SWIPE.velocityWindowMs * 2
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift()
  }

  /** px/ms over the window ending at `now`. Zero if the pointer rested before release. */
  velocity(now: number): { vx: number; vy: number } {
    const recent = this.samples.filter((s) => s.t >= now - SWIPE.velocityWindowMs)
    if (recent.length < 2) return { vx: 0, vy: 0 }
    const first = recent[0]
    const last = recent[recent.length - 1]
    const dt = Math.max(last.t - first.t, 1)
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
  }
}

/**
 * Commit if the card is past 35% of its width, or if it was flicked faster than the flick
 * threshold in the same direction it is offset. Otherwise null (snap back).
 */
export function commitDirection(dx: number, vx: number, cardWidth: number): Direction | null {
  if (dx === 0) return null
  const direction: Direction = dx > 0 ? 'right' : 'left'
  if (Math.abs(dx) > SWIPE.commitFraction * cardWidth) return direction
  if (Math.abs(vx) > SWIPE.flickVelocity && Math.sign(vx) === Math.sign(dx)) return direction
  return null
}

export type FlingInput = {
  direction: Direction
  dx: number
  dy: number
  rotation: number
  vx: number
  vy: number
  /** Left edge of the card at rest (no translate, no rotation), in viewport px. */
  cardLeft: number
  cardWidth: number
  cardHeight: number
  viewportWidth: number
}

export type FlingPlan = { toX: number; toY: number; toRotation: number; durationMs: number }

/**
 * Fling target and duration. The card keeps its momentum: it moves at constant velocity, starting
 * at the release speed, until its rotated box is fully off-screen (it is gone before a decelerating
 * tail would show). It keeps its vertical velocity and keeps spinning. Duration = distance / speed,
 * clamped to 100-600 ms, so faster flicks exit sooner and a slow release still leaves briskly.
 */
export function planFling(input: FlingInput): FlingPlan {
  const sign = input.direction === 'right' ? 1 : -1
  const reach = Math.hypot(input.cardWidth, input.cardHeight) / 2
  const targetCenterX = sign > 0 ? input.viewportWidth + reach : -reach
  const toX = targetCenterX - (input.cardLeft + input.cardWidth / 2)
  const distance = Math.abs(toX - input.dx)
  const speed = Math.max(Math.abs(input.vx), SWIPE.minFlingSpeed)
  const durationMs = clamp(distance / speed, SWIPE.minFlingMs, SWIPE.maxFlingMs)
  const drift = clamp(input.vy * durationMs, -SWIPE.maxFlingDriftY, SWIPE.maxFlingDriftY)
  const spinSign = input.rotation === 0 ? sign : Math.sign(input.rotation)
  return {
    toX,
    toY: input.dy + drift,
    toRotation: input.rotation + spinSign * SWIPE.flingSpin,
    durationMs,
  }
}

/** Start x-speed of a planned fling, px/ms (the motion is constant-velocity). */
export function flingStartSpeed(plan: FlingPlan, fromX: number): number {
  return Math.abs(plan.toX - fromX) / plan.durationMs
}

export type SpringState = { position: number; velocity: number }

/**
 * One step of a damped spring pulling toward 0. Units: position px (or deg), velocity per second.
 * Semi-implicit Euler, sub-stepped for stability at low frame rates.
 */
export function springStep(state: SpringState, dtMs: number): SpringState {
  let { position, velocity } = state
  const steps = Math.max(1, Math.ceil(dtMs / 8))
  const dt = dtMs / 1000 / steps
  for (let i = 0; i < steps; i++) {
    const accel = -SWIPE.springStiffness * position - SWIPE.springDamping * velocity
    velocity += accel * dt
    position += velocity * dt
  }
  return { position, velocity }
}

export function springSettled(state: SpringState): boolean {
  return Math.abs(state.position) < 0.5 && Math.abs(state.velocity) < 5
}

/** 0 at rest, 1 at the commit threshold. Drives stamps and the next card. */
export function dragProgress(dx: number, cardWidth: number): number {
  return clamp(Math.abs(dx) / (SWIPE.commitFraction * cardWidth), 0, 1)
}

/** Transform for the card `depth` places under the top (1 = next), given drag progress. */
export function underCardTransform(depth: number, progress: number): { scale: number; drop: number } {
  const step = 1 - SWIPE.nextScale
  const scale = 1 - step * (depth - progress)
  const drop = SWIPE.nextDrop * (depth - progress)
  return { scale, drop }
}
