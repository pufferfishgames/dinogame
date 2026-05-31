import { normalizePlayerName } from './player.js'

export const REALTIME_SEND_INTERVAL_MS = 1
export const REALTIME_MAX_BUFFERED_AMOUNT = 0
export const REALTIME_CHANNEL = 'dinogame-state-v1'

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]
const MAX_REMOTE_SPEED = 1800

export function shouldOfferConnection(localPubkey, remotePubkey) {
  const local = String(localPubkey ?? '')
  const remote = String(remotePubkey ?? '')
  return Boolean(local && remote && local < remote)
}

export function createRealtimeUpdate({
  name,
  score = 0,
  distance,
  speed = 0,
  state = 'lobby',
  jumpY = 0,
  raceId = '',
  elapsed = 0,
  seq = 0,
} = {}) {
  const normalizedScore = Math.max(0, Math.floor(Number(score) || 0))

  return {
    type: 'state',
    name: normalizePlayerName(name),
    score: normalizedScore,
    distance: normalizeDistance(distance, normalizedScore),
    speed: normalizeSpeed(speed),
    state: String(state || 'lobby'),
    jumpY: clampJumpY(jumpY),
    raceId: String(raceId ?? ''),
    elapsed: Math.max(0, Number(elapsed) || 0),
    seq: Math.max(0, Math.floor(Number(seq) || 0)),
  }
}

export function serializeRealtimeMessage(message) {
  return JSON.stringify(createRealtimeUpdate(message))
}

export function parseRealtimeMessage(raw, { pubkey = '' } = {}) {
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (payload?.type !== 'state') return null
    return {
      ...createRealtimeUpdate(payload),
      pubkey: String(pubkey || payload.pubkey || ''),
    }
  } catch {
    return null
  }
}

export function createRealtimeMesh({
  localPubkey,
  publishSignal,
  onMessage,
  onPeerStatus,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  iceServers = DEFAULT_ICE_SERVERS,
} = {}) {
  if (!RTCPeerConnectionImpl || !localPubkey || typeof publishSignal !== 'function') {
    return createDisabledMesh()
  }

  return new RealtimeMesh({
    localPubkey,
    publishSignal,
    onMessage,
    onPeerStatus,
    RTCPeerConnectionImpl,
    iceServers,
  })
}

class RealtimeMesh {
  constructor({
    localPubkey,
    publishSignal,
    onMessage,
    onPeerStatus,
    RTCPeerConnectionImpl,
    iceServers,
  }) {
    this.localPubkey = localPubkey
    this.publishSignal = publishSignal
    this.onMessage = onMessage
    this.onPeerStatus = onPeerStatus
    this.RTCPeerConnectionImpl = RTCPeerConnectionImpl
    this.iceServers = iceServers
    this.peers = new Map()
    this.lastStatusKey = ''
  }

  updatePlayers(players = []) {
    const remotePubkeys = new Set(
      players
        .map((player) => player?.pubkey)
        .filter((pubkey) => pubkey && pubkey !== this.localPubkey),
    )

    for (const pubkey of remotePubkeys) {
      const peer = this.ensurePeer(pubkey)
      if (shouldOfferConnection(this.localPubkey, pubkey) && !peer.offerStarted) {
        peer.offerStarted = true
        this.startOffer(peer)
      }
    }

    for (const [pubkey, peer] of this.peers) {
      if (!remotePubkeys.has(pubkey)) {
        closePeer(peer)
        this.peers.delete(pubkey)
      }
    }

    this.emitStatus()
  }

  async handleSignal(signal) {
    if (!signal || signal.to !== this.localPubkey || signal.pubkey === this.localPubkey) return

    const peer = this.ensurePeer(signal.pubkey)
    try {
      if (signal.type === 'offer' && signal.description) {
        await peer.pc.setRemoteDescription(signal.description)
        await this.flushPendingCandidates(peer)
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        this.publishSignal({
          type: 'answer',
          to: signal.pubkey,
          description: peer.pc.localDescription,
        })
      } else if (signal.type === 'answer' && signal.description) {
        await peer.pc.setRemoteDescription(signal.description)
        await this.flushPendingCandidates(peer)
      } else if (signal.type === 'ice' && signal.candidate) {
        if (hasRemoteDescription(peer.pc)) {
          await peer.pc.addIceCandidate(signal.candidate)
        } else {
          peer.pendingCandidates.push(signal.candidate)
        }
      }
    } catch {
      closePeer(peer)
      this.peers.delete(signal.pubkey)
      this.emitStatus()
    }
  }

  isPeerConnected(pubkey) {
    const peer = this.peers.get(pubkey)
    return peer?.channel?.readyState === 'open'
  }

  broadcast(message) {
    const payload = serializeRealtimeMessage(message)
    let sent = 0
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === 'open') {
        const bufferedAmount = Math.max(0, Number(peer.channel.bufferedAmount) || 0)
        if (bufferedAmount > REALTIME_MAX_BUFFERED_AMOUNT) continue
        try {
          peer.channel.send(payload)
          sent += 1
        } catch {
          closePeer(peer)
        }
      }
    }
    this.emitStatus()
    return sent
  }

  close() {
    for (const peer of this.peers.values()) closePeer(peer)
    this.peers.clear()
    this.emitStatus()
  }

  ensurePeer(pubkey) {
    const existing = this.peers.get(pubkey)
    if (existing) return existing

    const pc = new this.RTCPeerConnectionImpl({ iceServers: this.iceServers })
    const peer = {
      pubkey,
      pc,
      channel: null,
      offerStarted: false,
      pendingCandidates: [],
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.publishSignal({
        type: 'ice',
        to: pubkey,
        candidate: event.candidate,
      })
    }
    pc.onconnectionstatechange = () => this.emitStatus()
    pc.oniceconnectionstatechange = () => this.emitStatus()
    pc.ondatachannel = (event) => {
      this.setupChannel(peer, event.channel)
    }

    if (shouldOfferConnection(this.localPubkey, pubkey)) {
      this.setupChannel(peer, pc.createDataChannel(REALTIME_CHANNEL, { ordered: false, maxRetransmits: 0 }))
    }

    this.peers.set(pubkey, peer)
    this.emitStatus()
    return peer
  }

  async startOffer(peer) {
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      this.publishSignal({
        type: 'offer',
        to: peer.pubkey,
        description: peer.pc.localDescription,
      })
    } catch {
      closePeer(peer)
      this.peers.delete(peer.pubkey)
      this.emitStatus()
    }
  }

  async flushPendingCandidates(peer) {
    const candidates = peer.pendingCandidates.splice(0)
    for (const candidate of candidates) {
      await peer.pc.addIceCandidate(candidate)
    }
  }

  setupChannel(peer, channel) {
    peer.channel = channel
    if ('bufferedAmountLowThreshold' in channel) channel.bufferedAmountLowThreshold = REALTIME_MAX_BUFFERED_AMOUNT
    channel.onopen = () => this.emitStatus()
    channel.onclose = () => this.emitStatus()
    channel.onerror = () => this.emitStatus()
    channel.onmessage = (event) => {
      const message = parseRealtimeMessage(event.data, { pubkey: peer.pubkey })
      if (message) this.onMessage?.(message)
    }
  }

  emitStatus() {
    const connected = [...this.peers.values()].filter((peer) => peer.channel?.readyState === 'open').length
    const total = this.peers.size
    const key = `${connected}:${total}`
    if (key === this.lastStatusKey) return
    this.lastStatusKey = key
    this.onPeerStatus?.({ connected, total })
  }
}

function createDisabledMesh() {
  return {
    updatePlayers() {},
    handleSignal() {},
    broadcast() { return 0 },
    isPeerConnected() { return false },
    close() {},
  }
}

function closePeer(peer) {
  try {
    peer.channel?.close?.()
  } catch {
    // Ignore broken browser implementations while falling back to relays.
  }
  try {
    peer.pc?.close?.()
  } catch {
    // Ignore broken browser implementations while falling back to relays.
  }
}

function hasRemoteDescription(pc) {
  return Boolean(pc?.remoteDescription || pc?.currentRemoteDescription)
}

function clampJumpY(value) {
  const y = Math.round(Number(value) || 0)
  return Math.max(-180, Math.min(0, y))
}

function normalizeSpeed(speed) {
  const value = Number(speed)
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_REMOTE_SPEED, value)) : 0
}

function normalizeDistance(distance, score = 0) {
  const value = Number(distance)
  if (Number.isFinite(value)) return Math.max(0, value)
  return Math.max(0, Math.floor(Number(score) || 0) * 10)
}
