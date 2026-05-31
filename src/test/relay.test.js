import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RELAYS,
  buildPublishMessage,
  buildScoreSubscribeMessage,
  buildSessionSubscribeMessage,
  normalizeRelayUrls,
  openSessionRelays,
  parseRelayMessage,
} from '../nostr/relay.js'

describe('relay message helpers', () => {
  it('builds publish and subscription messages for scores and sessions', () => {
    expect(buildPublishMessage({ id: 'abc' })).toBe(JSON.stringify(['EVENT', { id: 'abc' }]))
    expect(JSON.parse(buildScoreSubscribeMessage('scores'))).toEqual([
      'REQ',
      'scores',
      { kinds: [30078], '#d': ['pufferfishgames/dinogame/total/v1'] },
    ])
    expect(JSON.parse(buildSessionSubscribeMessage('room'))).toEqual([
      'REQ',
      'room',
      { kinds: [20000], '#d': ['pufferfishgames/dinogame/session/v1'] },
      { kinds: [20001], '#d': ['pufferfishgames/dinogame/webrtc/v1'] },
    ])
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

  it('avoids relay endpoints known to be unavailable', () => {
    expect(DEFAULT_RELAYS).not.toContain('wss://relay.damus.io')
    expect(DEFAULT_RELAYS).not.toContain('wss://relay.nostr.band')
    expect(DEFAULT_RELAYS.length).toBeGreaterThanOrEqual(3)
  })

  it('normalizes relay lists to unique secure websocket urls', () => {
    expect(normalizeRelayUrls(['wss://a.example', 'http://bad.example', 'wss://a.example'])).toEqual([
      'wss://a.example',
    ])
  })

  it('falls back to local play when websocket construction fails', async () => {
    const statuses = []
    class FailingWebSocket {
      constructor() {
        throw new Error('blocked')
      }
    }

    const client = openSessionRelays(['wss://blocked.example'], {
      onStatus: (status) => statuses.push(status),
    }, FailingWebSocket)

    expect(client.send({ id: 'event' })).toBe(0)
    await Promise.resolve()
    expect(statuses).toContain('local')
  })

  it('publishes session events to every connected relay', () => {
    class FakeWebSocket {
      static OPEN = 1
      static instances = []

      constructor(url) {
        this.url = url
        this.readyState = 0
        this.sent = []
        FakeWebSocket.instances.push(this)
      }

      open() {
        this.readyState = FakeWebSocket.OPEN
        this.onopen?.()
      }

      send(message) {
        this.sent.push(JSON.parse(message))
      }

      close() {
        this.readyState = 3
        this.onclose?.()
      }
    }

    const client = openSessionRelays(['wss://a.example', 'wss://b.example'], {}, FakeWebSocket)
    FakeWebSocket.instances.forEach((socket) => socket.open())

    expect(client.send({ id: 'event' })).toBe(2)
    expect(FakeWebSocket.instances.map((socket) => socket.sent.at(-1))).toEqual([
      ['EVENT', { id: 'event' }],
      ['EVENT', { id: 'event' }],
    ])
  })
})
