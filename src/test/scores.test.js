import { describe, expect, it } from 'vitest'
import {
  createScoreEvent,
  createSignalEvent,
  createSessionEvent,
  getTotalScores,
  parseScoreEvent,
  parseSignalEvent,
  parseSessionEvent,
  signEvent,
} from '../nostr/events.js'
import { passphraseToPrivkey, privkeyToPubkey } from '../nostr/identity.js'

describe('Nostr score events', () => {
  it('creates signed application-specific score events', () => {
    const privkey = passphraseToPrivkey('score test')
    const pubkey = privkeyToPubkey(privkey)
    const event = signEvent(createScoreEvent(pubkey, { name: 'runnerrex', score: 1234 }), privkey)

    expect(event.id).toHaveLength(64)
    expect(event.sig).toHaveLength(128)
    expect(event.kind).toBe(30078)
    expect(event.tags).toContainEqual(['d', 'pufferfishgames/dinogame/total/v1'])
  })

  it('parses and sorts the latest cumulative total per public key', () => {
    const events = [
      createScoreEvent('a', { name: 'ALICE', score: 300 }, { now: 10 }),
      createScoreEvent('b', { name: 'BOB', score: 500 }, { now: 11 }),
      createScoreEvent('a', { name: 'ALICE', score: 150 }, { now: 12 }),
    ]

    expect(parseScoreEvent(events[0])).toMatchObject({ name: 'ALICE', score: 300 })
    expect(getTotalScores(events).map((score) => [score.name, score.score])).toEqual([
      ['BOB', 500],
      ['ALICE', 150],
    ])
  })

  it('deduplicates total scores by display name', () => {
    const events = [
      createScoreEvent('a', { name: 'NIKOLAI', score: 300 }, { now: 10 }),
      createScoreEvent('b', { name: 'NIKOLAI', score: 500 }, { now: 11 }),
      createScoreEvent('c', { name: 'CARA', score: 450 }, { now: 12 }),
    ]

    expect(getTotalScores(events).map((score) => [score.name, score.score])).toEqual([
      ['NIKOLAI', 500],
      ['CARA', 450],
    ])
  })

  it('records blank score names with the playable fallback name', () => {
    const event = createScoreEvent('a', { name: '', score: 100 }, { now: 10 })

    expect(parseScoreEvent(event)).toMatchObject({ name: 'GUEST', score: 100 })
  })

  it('records jump motion in session events so remote players can animate', () => {
    const event = createSessionEvent('pubkey', {
      name: 'BOB',
      score: 42,
      distance: 429.7,
      state: 'racing',
      jumpY: -64.4,
      race: { id: 'race-1' },
    }, { now: 10 })

    expect(parseSessionEvent(event)).toMatchObject({
      pubkey: 'pubkey',
      name: 'BOB',
      score: 42,
      distance: 429.7,
      state: 'racing',
      jumpY: -64,
      race: { id: 'race-1' },
    })
  })

  it('creates and parses signed WebRTC signaling events', () => {
    const event = createSignalEvent('alice-pubkey', {
      type: 'offer',
      to: 'bob-pubkey',
      description: { type: 'offer', sdp: 'sdp' },
    }, { now: 12 })

    expect(event.kind).toBe(20001)
    expect(event.tags).toContainEqual(['d', 'pufferfishgames/dinogame/webrtc/v1'])
    expect(event.tags).toContainEqual(['p', 'bob-pubkey'])
    expect(parseSignalEvent(event)).toMatchObject({
      pubkey: 'alice-pubkey',
      type: 'offer',
      to: 'bob-pubkey',
      description: { type: 'offer', sdp: 'sdp' },
      createdAt: 12,
    })
  })
})
