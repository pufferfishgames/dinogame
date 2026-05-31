import { describe, expect, it } from 'vitest'
import { buildRemotePlayerSprites } from '../game/remotePlayers.js'

describe('remote player sprites', () => {
  it('returns only other active players with display names', () => {
    const sprites = buildRemotePlayerSprites({
      players: [
        { pubkey: 'local', name: 'ME', score: 120, state: 'racing' },
        { pubkey: 'b', name: 'BOB', score: 180, state: 'racing' },
        { pubkey: 'c', name: 'CARA', score: 90, state: 'lobby' },
      ],
      localPubkey: 'local',
      localScore: 120,
    })

    expect(sprites.map((sprite) => sprite.name)).toEqual(['BOB', 'CARA'])
    expect(sprites.every((sprite) => sprite.pubkey !== 'local')).toBe(true)
    expect(sprites.every((sprite) => Number.isFinite(sprite.x) && Number.isFinite(sprite.y))).toBe(true)
  })

  it('places racing players relative to local progress and staggers lanes', () => {
    const sprites = buildRemotePlayerSprites({
      players: [
        { pubkey: 'ahead', name: 'AHEAD', score: 220, state: 'racing' },
        { pubkey: 'behind', name: 'BEHIND', score: 60, state: 'racing' },
      ],
      localPubkey: 'local',
      localScore: 120,
    })

    expect(sprites[0]).toMatchObject({ pubkey: 'ahead', name: 'AHEAD' })
    expect(sprites[0].x).toBeGreaterThan(sprites[1].x)
    expect(sprites[0].y).not.toBe(sprites[1].y)
  })
})
