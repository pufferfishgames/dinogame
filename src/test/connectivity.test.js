import { describe, expect, it } from 'vitest'
import { connectionLabel, connectionTone } from '../game/connectivity.js'

describe('connection display', () => {
  it('does not show a disconnected state before the player joins', () => {
    expect(connectionLabel('offline', false)).toBe('Ready')
    expect(connectionTone('offline', false)).toBe('idle')
  })

  it('keeps gameplay available when relays fail on mobile', () => {
    expect(connectionLabel('offline', true)).toBe('Solo ready')
    expect(connectionLabel('error', true)).toBe('Solo ready')
    expect(connectionLabel('local', true)).toBe('Solo ready')
    expect(connectionTone('offline', true)).toBe('local')
  })

  it('shows multiplayer state only when a relay is actually connected', () => {
    expect(connectionLabel('connecting', true)).toBe('Connecting')
    expect(connectionLabel('connected', true)).toBe('Online')
    expect(connectionTone('connected', true)).toBe('online')
  })
})
