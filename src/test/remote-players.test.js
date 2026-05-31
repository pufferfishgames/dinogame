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

  it('predicts a racing player forward from speed and local race elapsed', () => {
    const [sprite] = buildRemotePlayerSprites({
      players: [{
        pubkey: 'remote',
        name: 'BOB',
        score: 100,
        distance: 1_000,
        speed: 300,
        elapsed: 5,
        state: 'racing',
        lastSeen: 1_000,
      }],
      localPubkey: 'local',
      localScore: 100,
      localDistance: 1_000,
      localElapsed: 5.2,
      now: 1_000,
    })

    expect(sprite.observedDistance).toBe(1_000)
    expect(sprite.distance).toBeCloseTo(1_060)
    expect(sprite.x).toBeCloseTo(156)
  })

  it('caps prediction when packets stop arriving', () => {
    const [sprite] = buildRemotePlayerSprites({
      players: [{
        pubkey: 'remote',
        name: 'BOB',
        score: 100,
        distance: 1_000,
        distanceVelocity: 300,
        state: 'racing',
        lastSeen: 1_000,
      }],
      localPubkey: 'local',
      localScore: 100,
      localDistance: 1_000,
      now: 2_000,
    })

    expect(sprite.distance).toBeCloseTo(1_135)
    expect(sprite.x).toBeCloseTo(231)
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

  it('does not wrap a far-behind slow player back onto the right side of the track', () => {
    const sprites = buildRemotePlayerSprites({
      players: [{
        pubkey: 'slow',
        name: 'SLOW',
        score: 100,
        distance: 1_000,
        speed: 300,
        elapsed: 4,
        state: 'racing',
        lastSeen: 1_000,
      }],
      localPubkey: 'local',
      localScore: 500,
      localDistance: 5_000,
      localElapsed: 20,
      now: 6_000,
    })

    expect(sprites).toEqual([])
  })

  it('does not render a merged same-name local player as a remote dinosaur', () => {
    const sprites = buildRemotePlayerSprites({
      players: [
        { pubkey: 'new-tab', pubkeys: ['old-tab', 'new-tab'], name: 'ALICE', score: 120, state: 'racing' },
        { pubkey: 'b', name: 'BOB', score: 100, state: 'racing' },
      ],
      localPubkey: 'old-tab',
      localName: 'ALICE',
      localScore: 120,
    })

    expect(sprites.map((sprite) => sprite.name)).toEqual(['BOB'])
  })

  it('treats matching names as the same local dinosaur even with a different pubkey', () => {
    const sprites = buildRemotePlayerSprites({
      players: [
        { pubkey: 'same-name', name: 'ALICE', score: 120, state: 'racing' },
        { pubkey: 'b', name: 'BOB', score: 100, state: 'racing' },
      ],
      localPubkey: 'local',
      localName: 'ALICE',
      localScore: 120,
    })

    expect(sprites.map((sprite) => sprite.name)).toEqual(['BOB'])
  })
})
