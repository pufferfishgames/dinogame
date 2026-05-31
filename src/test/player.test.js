import { describe, expect, it } from 'vitest'
import { normalizeEditablePlayerName, normalizePlayerName } from '../game/player.js'

describe('normalizePlayerName', () => {
  it('trims, uppercases, and caps names at seven letters', () => {
    expect(normalizePlayerName('  runnerrex  ')).toBe('RUNNERR')
  })

  it('keeps only letters and digits', () => {
    expect(normalizePlayerName('tiny-dino!')).toBe('TINYDIN')
  })

  it('falls back to GUEST for blank input', () => {
    expect(normalizePlayerName('!!!')).toBe('GUEST')
  })

  it('allows blank intermediate values while editing on mobile keyboards', () => {
    expect(normalizeEditablePlayerName('')).toBe('')
    expect(normalizeEditablePlayerName('!!!')).toBe('')
  })

  it('normalizes editable input without injecting fallback text', () => {
    expect(normalizeEditablePlayerName(' re-x 7 ')).toBe('REX7')
  })
})
