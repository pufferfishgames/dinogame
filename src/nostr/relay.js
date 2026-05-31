import {
  SCORE_D_TAG,
  SCORE_KIND,
  SESSION_D_TAG,
  SESSION_KIND,
  getTotalScores,
  parseScoreEvent,
} from './events.js'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
]

export function normalizeRelayUrls(relayUrls = DEFAULT_RELAYS) {
  const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls]
  return [...new Set(urls
    .map((url) => String(url ?? '').trim())
    .filter((url) => /^wss:\/\//i.test(url)))]
}

export function buildPublishMessage(event) {
  return JSON.stringify(['EVENT', event])
}

export function buildScoreSubscribeMessage(subscriptionId) {
  return JSON.stringify([
    'REQ',
    subscriptionId,
    { kinds: [SCORE_KIND], '#d': [SCORE_D_TAG] },
  ])
}

export function buildSessionSubscribeMessage(subscriptionId) {
  return JSON.stringify([
    'REQ',
    subscriptionId,
    { kinds: [SESSION_KIND], '#d': [SESSION_D_TAG] },
  ])
}

export function parseRelayMessage(raw) {
  const msg = JSON.parse(raw)
  switch (msg[0]) {
    case 'EVENT':
      return { type: 'EVENT', subscriptionId: msg[1], event: msg[2] }
    case 'EOSE':
      return { type: 'EOSE', subscriptionId: msg[1] }
    case 'NOTICE':
      return { type: 'NOTICE', message: msg[1] }
    case 'OK':
      return { type: 'OK', eventId: msg[1], accepted: msg[2], message: msg[3] }
    default:
      return { type: msg[0] }
  }
}

export async function publishEvent(relayUrls, event) {
  const urls = normalizeRelayUrls(relayUrls)
  const results = await Promise.allSettled(urls.map((url) => publishEventToRelay(url, event)))
  const accepted = results.find((result) => result.status === 'fulfilled')
  if (accepted) return accepted.value
  throw new Error('relay publish failed')
}

function publishEventToRelay(relayUrl, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('relay publish timed out'))
    }, 5000)

    ws.onopen = () => ws.send(buildPublishMessage(event))
    ws.onmessage = (e) => {
      const msg = parseRelayMessage(e.data)
      if (msg.type === 'OK' || msg.type === 'NOTICE') {
        clearTimeout(timeout)
        ws.close()
        resolve(msg)
      }
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('relay publish failed'))
    }
  })
}

export async function fetchTotalScores(relayUrls, limit = 10) {
  const urls = normalizeRelayUrls(relayUrls)
  if (!urls.length) return []

  const results = await Promise.allSettled(urls.map((url) => fetchTotalScoresFromRelay(url)))
  const events = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  return getTotalScores(events, limit)
}

function fetchTotalScoresFromRelay(relayUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    const events = []
    const subId = `scores-${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      ws.close()
      resolve(events)
    }, 4500)

    ws.onopen = () => ws.send(buildScoreSubscribeMessage(subId))
    ws.onmessage = (e) => {
      const msg = parseRelayMessage(e.data)
      if (msg.type === 'EVENT' && parseScoreEvent(msg.event)) {
        events.push(msg.event)
      } else if (msg.type === 'EOSE') {
        clearTimeout(timeout)
        ws.close()
        resolve(events)
      }
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('relay fetch failed'))
    }
  })
}

export function openSessionRelay(relayUrl, { onEvent, onOpen, onStatus } = {}) {
  return openSessionRelays([relayUrl], { onEvent, onOpen, onStatus })
}

export function openSessionRelays(
  relayUrls,
  { onEvent, onOpen, onStatus } = {},
  WebSocketImpl = globalThis.WebSocket,
) {
  const urls = normalizeRelayUrls(relayUrls)
  const sockets = []
  const connected = new Set()
  let pending = urls.length
  let closed = false

  if (!WebSocketImpl || !urls.length) {
    queueMicrotask(() => onStatus?.('local', { connected: 0, total: urls.length }))
    return createSessionClient(sockets, WebSocketImpl, onStatus)
  }

  onStatus?.('connecting', { connected: 0, total: urls.length })

  for (const url of urls) {
    let ws
    try {
      ws = new WebSocketImpl(url)
    } catch {
      pending -= 1
      continue
    }

    sockets.push(ws)
    const subId = `session-${Math.random().toString(36).slice(2)}`
    let settled = false

    const settle = () => {
      if (settled) return
      settled = true
      pending = Math.max(0, pending - 1)
    }

    ws.onopen = () => {
      settle()
      connected.add(ws)
      ws.send(buildSessionSubscribeMessage(subId))
      onOpen?.(ws, url)
      emitSessionStatus()
    }

    ws.onmessage = (e) => {
      const msg = parseRelayMessage(e.data)
      if (msg.type === 'EVENT') onEvent?.(msg.event, url)
    }

    ws.onerror = () => {
      settle()
      emitSessionStatus()
    }

    ws.onclose = () => {
      settle()
      connected.delete(ws)
      emitSessionStatus()
    }
  }

  emitSessionStatus()

  return {
    send(event) {
      const message = buildPublishMessage(event)
      let sent = 0
      for (const ws of sockets) {
        if (isOpen(ws, WebSocketImpl)) {
          try {
            ws.send(message)
            sent += 1
          } catch {
            connected.delete(ws)
          }
        }
      }
      if (!sent && !closed) onStatus?.('local', { connected: connected.size, total: urls.length })
      return sent
    },
    close() {
      closed = true
      sockets.forEach((ws) => ws.close())
    },
  }

  function emitSessionStatus() {
    if (closed) return
    if (connected.size > 0) {
      onStatus?.('connected', { connected: connected.size, total: urls.length })
    } else if (pending === 0) {
      onStatus?.('local', { connected: 0, total: urls.length })
    } else {
      onStatus?.('connecting', { connected: 0, total: urls.length })
    }
  }
}

function createSessionClient(sockets, WebSocketImpl, onStatus) {
  return {
    send() {
      onStatus?.('local', { connected: 0, total: 0 })
      return 0
    },
    close() {
      sockets.forEach((ws) => ws.close())
    },
  }
}

function isOpen(ws, WebSocketImpl) {
  return ws.readyState === (WebSocketImpl?.OPEN ?? 1)
}
