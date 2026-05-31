import { describe, expect, it } from 'vitest'
import {
  createScoreEvent,
  createSessionEvent,
  getBestScores,
  parseScoreEvent,
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
    expect(event.tags).toContainEqual(['d', 'pufferfishgames/dinogame/highscore/v2'])
  })

  it('parses and sorts the best score per public key', () => {
    const events = [
      createScoreEvent('a', { name: 'ALICE', score: 300 }, { now: 10 }),
      createScoreEvent('b', { name: 'BOB', score: 500 }, { now: 11 }),
      createScoreEvent('a', { name: 'ALICE', score: 700 }, { now: 12 }),
    ]

    expect(parseScoreEvent(events[0])).toMatchObject({ name: 'ALICE', score: 300 })
    expect(getBestScores(events).map((score) => [score.name, score.score])).toEqual([
      ['ALICE', 700],
      ['BOB', 500],
    ])
  })

  it('records jump motion in session events so remote players can animate', () => {
    const event = createSessionEvent('pubkey', {
      name: 'BOB',
      score: 42,
      state: 'racing',
      jumpY: -64.4,
      race: { id: 'race-1' },
    }, { now: 10 })

    expect(parseSessionEvent(event)).toMatchObject({
      pubkey: 'pubkey',
      name: 'BOB',
      score: 42,
      state: 'racing',
      jumpY: -64,
      race: { id: 'race-1' },
    })
  })
})
