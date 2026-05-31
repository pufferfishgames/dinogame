import { describe, expect, it } from 'vitest'
import {
  REALTIME_CHANNEL,
  REALTIME_SEND_INTERVAL_MS,
  createRealtimeMesh,
  createRealtimeUpdate,
  parseRealtimeMessage,
  serializeRealtimeMessage,
  shouldOfferConnection,
} from '../game/webrtc.js'

describe('WebRTC realtime helpers', () => {
  it('uses a low realtime send interval for sub-5ms latency', () => {
    expect(REALTIME_SEND_INTERVAL_MS).toBeLessThanOrEqual(5)
  })

  it('chooses one deterministic offerer for each peer pair', () => {
    expect(shouldOfferConnection('a', 'b')).toBe(true)
    expect(shouldOfferConnection('b', 'a')).toBe(false)
    expect(shouldOfferConnection('a', 'a')).toBe(false)
  })

  it('serializes compact state snapshots for lossy data channels', () => {
    const raw = serializeRealtimeMessage({
      name: 'runnerrex',
      score: 42.9,
      distance: 429.7,
      state: 'racing',
      jumpY: -64.4,
      raceId: 'race-1',
      elapsed: 12.25,
      seq: 3,
    })

    expect(parseRealtimeMessage(raw, { pubkey: 'remote' })).toMatchObject({
      pubkey: 'remote',
      name: 'RUNNERR',
      score: 42,
      distance: 429.7,
      state: 'racing',
      jumpY: -64,
      raceId: 'race-1',
      elapsed: 12.25,
      seq: 3,
    })
  })

  it('ignores malformed realtime channel payloads', () => {
    expect(parseRealtimeMessage('{')).toBe(null)
    expect(parseRealtimeMessage(JSON.stringify({ type: 'chat' }))).toBe(null)
  })

  it('creates offers and publishes ice through an injectable peer connection', async () => {
    const signals = []
    const statuses = []

    class FakePeerConnection {
      constructor(config) {
        this.config = config
        this.localDescription = null
        this.createdChannels = []
      }

      createDataChannel(label, options) {
        const channel = {
          label,
          options,
          readyState: 'connecting',
          send() {},
          close() {},
        }
        this.createdChannels.push(channel)
        return channel
      }

      async createOffer() {
        return { type: 'offer', sdp: 'offer-sdp' }
      }

      async setLocalDescription(description) {
        this.localDescription = description
      }

      close() {}
    }

    const mesh = createRealtimeMesh({
      localPubkey: 'a',
      publishSignal: (signal) => signals.push(signal),
      onPeerStatus: (status) => statuses.push(status),
      RTCPeerConnectionImpl: FakePeerConnection,
    })

    mesh.updatePlayers([{ pubkey: 'a' }, { pubkey: 'b' }])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(signals[0]).toEqual({
      type: 'offer',
      to: 'b',
      description: { type: 'offer', sdp: 'offer-sdp' },
    })
    expect(statuses.at(-1)).toMatchObject({ connected: 0, total: 1 })

    const peer = [...mesh.peers.values()][0]
    expect(peer.channel.label).toBe(REALTIME_CHANNEL)

    peer.pc.onicecandidate({ candidate: { candidate: 'candidate-1' } })
    expect(signals.at(-1)).toEqual({
      type: 'ice',
      to: 'b',
      candidate: { candidate: 'candidate-1' },
    })
  })

  it('reports whether a data channel to a peer is open', () => {
    class FakePeerConnection {
      constructor() {}
      close() {}
    }

    const mesh = createRealtimeMesh({
      localPubkey: 'b',
      publishSignal() {},
      RTCPeerConnectionImpl: FakePeerConnection,
    })

    mesh.updatePlayers([{ pubkey: 'a' }, { pubkey: 'b' }])
    expect(mesh.isPeerConnected('a')).toBe(false)
    expect(mesh.isPeerConnected('unknown')).toBe(false)

    const peer = [...mesh.peers.values()][0]
    const channel = { readyState: 'open', close() {} }
    peer.pc.ondatachannel({ channel })

    expect(mesh.isPeerConnected('a')).toBe(true)
  })

  it('buffers ICE candidates that arrive before the remote description', async () => {
    class FakePeerConnection {
      constructor() {
        this.remoteDescription = null
        this.addedCandidates = []
      }

      async setRemoteDescription(description) {
        this.remoteDescription = description
      }

      async createAnswer() {
        return { type: 'answer', sdp: 'answer-sdp' }
      }

      async setLocalDescription(description) {
        this.localDescription = description
      }

      async addIceCandidate(candidate) {
        if (!this.remoteDescription) throw new Error('remote description missing')
        this.addedCandidates.push(candidate)
      }

      close() {
        this.closed = true
      }
    }

    const mesh = createRealtimeMesh({
      localPubkey: 'b',
      publishSignal() {},
      RTCPeerConnectionImpl: FakePeerConnection,
    })

    await mesh.handleSignal({
      pubkey: 'a',
      to: 'b',
      type: 'ice',
      candidate: { candidate: 'early' },
    })

    const peer = mesh.peers.get('a')
    expect(peer.pc.closed).not.toBe(true)
    expect(peer.pc.addedCandidates).toEqual([])

    await mesh.handleSignal({
      pubkey: 'a',
      to: 'b',
      type: 'offer',
      description: { type: 'offer', sdp: 'offer-sdp' },
    })

    expect(peer.pc.addedCandidates).toEqual([{ candidate: 'early' }])
  })

  it('applies remote data channel messages to the owning peer pubkey', () => {
    const messages = []

    class FakePeerConnection {
      constructor() {}
      close() {}
    }

    const mesh = createRealtimeMesh({
      localPubkey: 'b',
      publishSignal() {},
      onMessage: (message) => messages.push(message),
      RTCPeerConnectionImpl: FakePeerConnection,
    })

    mesh.updatePlayers([{ pubkey: 'a' }, { pubkey: 'b' }])
    const peer = [...mesh.peers.values()][0]
    const channel = { readyState: 'open', close() {} }
    peer.pc.ondatachannel({ channel })

    channel.onmessage({
      data: JSON.stringify(createRealtimeUpdate({
        name: 'ALICE',
        score: 100,
        state: 'racing',
        pubkey: 'spoofed',
      })),
    })

    expect(messages).toMatchObject([{ pubkey: 'a', name: 'ALICE', score: 100 }])
  })
})
