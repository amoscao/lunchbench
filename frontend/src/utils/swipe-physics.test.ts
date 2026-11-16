import { describe, expect, test } from 'vitest'
import {
  commitDirection,
  dragProgress,
  easeOutCubic,
  planFling,
  rotationFor,
  springSettled,
  springStep,
  SWIPE,
  underCardTransform,
  VelocityTracker,
} from './swipe-physics'

const WIDTH = 380

describe('drag rotation', () => {
  test('is proportional to x and capped near ±20°', () => {
    expect(rotationFor(100, true)).toBeCloseTo(7)
    expect(rotationFor(1000, true)).toBe(20)
    expect(rotationFor(-1000, true)).toBe(-20)
  })

  test('flips sign when grabbed in the bottom half', () => {
    expect(rotationFor(100, false)).toBeCloseTo(-7)
  })
})

describe('release velocity', () => {
  test('measures the last ~100 ms of moves', () => {
    const tracker = new VelocityTracker()
    tracker.reset(0, 0, 0)
    tracker.add(500, 10, 0)
    tracker.add(550, 40, 5)
    tracker.add(600, 90, 10)
    const { vx, vy } = tracker.velocity(600)
    expect(vx).toBeCloseTo(80 / 100)
    expect(vy).toBeCloseTo(10 / 100)
  })

  test('is zero when the pointer rests before release', () => {
    const tracker = new VelocityTracker()
    tracker.reset(0, 0, 0)
    tracker.add(20, 60, 0)
    expect(tracker.velocity(300)).toEqual({ vx: 0, vy: 0 })
  })
})

describe('commit rule', () => {
  test('commits past 35% of the card width', () => {
    expect(commitDirection(0.36 * WIDTH, 0, WIDTH)).toBe('right')
    expect(commitDirection(-0.36 * WIDTH, 0, WIDTH)).toBe('left')
  })

  test('snaps back below the threshold when slow', () => {
    expect(commitDirection(0.3 * WIDTH, 0.2, WIDTH)).toBeNull()
    expect(commitDirection(0, 2, WIDTH)).toBeNull()
  })

  test('a fast short flick commits', () => {
    expect(commitDirection(40, 0.8, WIDTH)).toBe('right')
    expect(commitDirection(-40, -0.8, WIDTH)).toBe('left')
  })

  test('a flick against the offset does not commit', () => {
    expect(commitDirection(40, -0.8, WIDTH)).toBeNull()
  })
})

describe('fling', () => {
  const base = { dx: 150, dy: 20, rotation: 10, vx: 1, vy: 0.3, cardLeft: 450, cardWidth: WIDTH, cardHeight: 440, viewportWidth: 1280 }

  test('travels until the rotated card is fully off-screen', () => {
    const plan = planFling({ ...base, direction: 'right' })
    const reach = Math.hypot(WIDTH, 440) / 2
    const endCenter = base.cardLeft + WIDTH / 2 + plan.toX
    expect(endCenter - reach).toBeGreaterThanOrEqual(base.viewportWidth)

    const left = planFling({ ...base, dx: -150, vx: -1, direction: 'left' })
    expect(base.cardLeft + WIDTH / 2 + left.toX + reach).toBeLessThanOrEqual(0)
  })

  test('faster flicks exit sooner, within 200-400 ms', () => {
    const slow = planFling({ ...base, vx: 1.3, direction: 'right' })
    const fast = planFling({ ...base, vx: 4, direction: 'right' })
    expect(fast.durationMs).toBeLessThan(slow.durationMs)
    expect(fast.durationMs).toBeGreaterThanOrEqual(SWIPE.minFlingMs)
    expect(slow.durationMs).toBeLessThanOrEqual(SWIPE.maxFlingMs)
  })

  test('keeps vertical drift and keeps spinning', () => {
    const plan = planFling({ ...base, direction: 'right' })
    expect(plan.toY).toBeGreaterThan(base.dy)
    expect(plan.toRotation).toBeGreaterThan(base.rotation)
  })

  test('button flings arc upward', () => {
    const plan = planFling({ ...base, dx: 0, dy: 0, rotation: 0, vx: SWIPE.buttonVelocityX, vy: SWIPE.buttonVelocityY, direction: 'right' })
    expect(plan.toY).toBeLessThan(0)
    expect(plan.toRotation).toBeGreaterThan(0)
  })

  test('the curve decelerates', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})

describe('snap-back spring', () => {
  test('returns to rest with a slight overshoot', () => {
    let state = { position: 100, velocity: 0 }
    let minimum = Infinity
    let frames = 0
    while (!springSettled(state) && frames < 200) {
      state = springStep(state, 16)
      minimum = Math.min(minimum, state.position)
      frames += 1
    }
    expect(springSettled(state)).toBe(true)
    expect(minimum).toBeLessThan(0)
    expect(minimum).toBeGreaterThan(-20)
    expect(frames * 16).toBeLessThan(1200)
  })
})

describe('next card', () => {
  test('scales from 0.95 to 1 and lifts with drag progress', () => {
    expect(dragProgress(0, WIDTH)).toBe(0)
    expect(dragProgress(SWIPE.commitFraction * WIDTH, WIDTH)).toBe(1)
    expect(underCardTransform(1, 0)).toEqual({ scale: 0.95, drop: 10 })
    const done = underCardTransform(1, 1)
    expect(done.scale).toBeCloseTo(1)
    expect(done.drop).toBeCloseTo(0)
    expect(underCardTransform(2, 0).scale).toBeCloseTo(0.9)
  })
})
