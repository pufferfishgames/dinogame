import {
  SCORE_D_TAG,
  SCORE_KIND,
  SESSION_D_TAG,
  SESSION_KIND,
  getBestScores,
  parseScoreEvent,
} from './events.js'

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

export async function publishEvent(relayUrl, event) {
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

export async function fetchBestScores(relayUrl, limit = 10) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    const events = []
    const subId = `scores-${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      ws.close()
      resolve(getBestScores(events, limit))
    }, 4500)

    ws.onopen = () => ws.send(buildScoreSubscribeMessage(subId))
    ws.onmessage = (e) => {
      const msg = parseRelayMessage(e.data)
      if (msg.type === 'EVENT' && parseScoreEvent(msg.event)) {
        events.push(msg.event)
      } else if (msg.type === 'EOSE') {
        clearTimeout(timeout)
        ws.close()
        resolve(getBestScores(events, limit))
      }
    }
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('relay fetch failed'))
    }
  })
}

export function openSessionRelay(relayUrl, { onEvent, onOpen, onStatus } = {}) {
  const ws = new WebSocket(relayUrl)
  const subId = `session-${Math.random().toString(36).slice(2)}`

  ws.onopen = () => {
    onStatus?.('connected')
    ws.send(buildSessionSubscribeMessage(subId))
    onOpen?.(ws)
  }
  ws.onmessage = (e) => {
    const msg = parseRelayMessage(e.data)
    if (msg.type === 'EVENT') onEvent?.(msg.event)
  }
  ws.onerror = () => onStatus?.('error')
  ws.onclose = () => onStatus?.('offline')

  return {
    send(event) {
      if (ws.readyState === WebSocket.OPEN) ws.send(buildPublishMessage(event))
    },
    close() {
      ws.close()
    },
  }
}
