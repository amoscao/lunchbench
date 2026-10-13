import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { initVeganMode, isVeganMode, isVeganToggleDisabled } from './vegan-mode'

const storage = new Map<string, string>()
const attributes = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => attributes.delete(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
    querySelector: () => null,
  },
})

describe('vegan mode toggle flag', () => {
  beforeEach(() => {
    storage.clear()
    attributes.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('is enabled when the flag is unset', () => {
    vi.stubEnv('VITE_DISABLE_VEGAN_TOGGLE', '')

    expect(isVeganToggleDisabled()).toBe(false)
  })

  test('clears saved vegan mode when the flag is on', () => {
    vi.stubEnv('VITE_DISABLE_VEGAN_TOGGLE', 'true')
    localStorage.setItem('vegan-mode', 'true')
    document.documentElement.setAttribute('data-vegan', 'true')
    const onToggle = vi.fn()

    initVeganMode(onToggle)

    expect(isVeganToggleDisabled()).toBe(true)
    expect(localStorage.getItem('vegan-mode')).toBeNull()
    expect(isVeganMode()).toBe(false)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
