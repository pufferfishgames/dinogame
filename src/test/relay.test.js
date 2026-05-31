import { describe, expect, it } from 'vitest'
import {
  buildPublishMessage,
  buildScoreSubscribeMessage,
  buildSessionSubscribeMessage,
  parseRelayMessage,
} from '../nostr/relay.js'

describe('relay message helpers', () => {
  it('builds publish and subscription messages for scores and sessions', () => {
    expect(buildPublishMessage({ id: 'abc' })).toBe(JSON.stringify(['EVENT', { id: 'abc' }]))
    expect(JSON.parse(buildScoreSubscribeMessage('scores'))).toEqual([
      'REQ',
      'scores',
      { kinds: [30078], '#d': ['pufferfishgames/dinogame/highscore'] },
    ])
    expect(JSON.parse(buildSessionSubscribeMessage('room'))[2]).toMatchObject({ kinds: [20000] })
  })

  it('parses common relay responses', () => {
    expect(parseRelayMessage(JSON.stringify(['EOSE', 'scores']))).toEqual({
      type: 'EOSE',
      subscriptionId: 'scores',
    })
    expect(parseRelayMessage(JSON.stringify(['OK', 'event-id', true, 'saved']))).toEqual({
      type: 'OK',
      eventId: 'event-id',
      accepted: true,
      message: 'saved',
    })
  })
})
