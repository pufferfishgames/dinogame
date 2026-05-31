import { describe, expect, it } from 'vitest'
import { getOrCreateSessionPassphrase } from '../game/joining.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

describe('joining identity', () => {
  it('uses per-tab session storage so later players do not overwrite earlier players', () => {
    const localStorage = createStorage()
    const firstTab = createStorage()
    const secondTab = createStorage()
    let counter = 0
    const createPassphrase = () => `pass-${counter += 1}`

    expect(getOrCreateSessionPassphrase({ sessionStorage: firstTab, localStorage, createPassphrase })).toBe('pass-1')
    expect(getOrCreateSessionPassphrase({ sessionStorage: secondTab, localStorage, createPassphrase })).toBe('pass-2')
    expect(getOrCreateSessionPassphrase({ sessionStorage: firstTab, localStorage, createPassphrase })).toBe('pass-1')
  })

  it('falls back to persistent storage only when session storage is unavailable', () => {
    const localStorage = createStorage()
    let counter = 0
    const createPassphrase = () => `pass-${counter += 1}`

    expect(getOrCreateSessionPassphrase({ sessionStorage: null, localStorage, createPassphrase })).toBe('pass-1')
    expect(getOrCreateSessionPassphrase({ sessionStorage: null, localStorage, createPassphrase })).toBe('pass-1')
  })
})
