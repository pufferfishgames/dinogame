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

  it('uses exact distance so overtakes move across the local dinosaur', () => {
    const [behind] = buildRemotePlayerSprites({
      players: [{ pubkey: 'remote', name: 'BOB', score: 100, distance: 990, state: 'racing' }],
      localPubkey: 'local',
      localScore: 100,
      localDistance: 1_000,
    })
    const [ahead] = buildRemotePlayerSprites({
      players: [{ pubkey: 'remote', name: 'BOB', score: 100, distance: 1_040, state: 'racing' }],
      localPubkey: 'local',
      localScore: 100,
      localDistance: 1_000,
    })

    expect(behind.x).toBeLessThan(96)
    expect(ahead.x).toBeGreaterThan(96)
    expect(ahead.x - behind.x).toBeCloseTo(50, 0)
  })

  it('moves a remote player upward when their presence reports a jump', () => {
    const [grounded] = buildRemotePlayerSprites({
      players: [{ pubkey: 'b', name: 'BOB', score: 120, state: 'racing', jumpY: 0 }],
      localPubkey: 'local',
      localScore: 120,
    })
    const [jumping] = buildRemotePlayerSprites({
      players: [{ pubkey: 'b', name: 'BOB', score: 120, state: 'racing', jumpY: -84 }],
      localPubkey: 'local',
      localScore: 120,
    })

    expect(jumping.y).toBeLessThan(grounded.y)
    expect(jumping.jumpY).toBe(-84)
  })

  it('does not render players that are far outside the current camera view', () => {
    const sprites = buildRemotePlayerSprites({
      players: [
        { pubkey: 'near', name: 'NEAR', score: 100, distance: 1_060, state: 'racing' },
        { pubkey: 'gone', name: 'GONE', score: 100, distance: 2_400, state: 'racing' },
      ],
      localPubkey: 'local',
      localScore: 100,
      localDistance: 1_000,
    })

    expect(sprites.map((sprite) => sprite.pubkey)).toEqual(['near'])
  })
})
