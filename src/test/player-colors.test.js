import { describe, expect, it } from 'vitest'
import { PLAYER_COLOR_PALETTE, playerColorForName } from '../game/playerColors.js'

describe('player colors', () => {
  it('assigns a stable color from the normalized player name', () => {
    expect(playerColorForName('alice')).toEqual(playerColorForName('ALICE'))
    expect(playerColorForName('alice')).toEqual(playerColorForName('alice!!!'))
  })

  it('uses colors from the shared palette', () => {
    expect(PLAYER_COLOR_PALETTE).toContainEqual(playerColorForName('BOB'))
  })

  it('gives common different names different colors', () => {
    expect(playerColorForName('ALICE')).not.toEqual(playerColorForName('BOB'))
  })
})
