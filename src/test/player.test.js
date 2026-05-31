import { describe, expect, it } from 'vitest'
import { normalizePlayerName } from '../game/player.js'

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
})
