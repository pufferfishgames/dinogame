import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { normalizePlayerName } from '../game/player.js'

export const SCORE_KIND = 30078
export const SCORE_D_TAG = 'pufferfishgames/dinogame/highscore'
export const SESSION_KIND = 20000
export const SESSION_D_TAG = 'pufferfishgames/dinogame/session/v1'

export function createScoreEvent(pubkey, score, { now = Math.floor(Date.now() / 1000) } = {}) {
  const parsed = normalizeScore(score)

  return {
    kind: SCORE_KIND,
    pubkey,
    created_at: now,
    tags: [
      ['d', SCORE_D_TAG],
      ['score', String(parsed.score)],
      ['name', parsed.name],
      ['t', 'dinogame'],
    ],
    content: JSON.stringify(parsed),
  }
}

export function createSessionEvent(pubkey, payload, { now = Math.floor(Date.now() / 1000) } = {}) {
  return {
    kind: SESSION_KIND,
    pubkey,
    created_at: now,
    tags: [
      ['d', SESSION_D_TAG],
      ['t', 'dinogame'],
    ],
    content: JSON.stringify({
      type: payload.type ?? 'presence',
      name: normalizePlayerName(payload.name),
      score: Math.max(0, Math.floor(Number(payload.score) || 0)),
      state: payload.state ?? 'lobby',
      jumpY: clampJumpY(payload.jumpY),
      race: payload.race ?? null,
    }),
  }
}

export function parseScoreEvent(event) {
  if (!event || event.kind !== SCORE_KIND || !hasTag(event, 'd', SCORE_D_TAG)) return null

  const fromContent = safeJson(event.content)
  const scoreTag = findTag(event, 'score')
  const nameTag = findTag(event, 'name')
  const score = Math.max(0, Math.floor(Number(fromContent.score ?? scoreTag?.[1]) || 0))

  return {
    eventId: event.id ?? '',
    pubkey: event.pubkey,
    name: normalizePlayerName(fromContent.name ?? nameTag?.[1]),
    score,
    createdAt: event.created_at ?? 0,
    raceId: fromContent.raceId ?? '',
  }
}

export function parseSessionEvent(event) {
  if (!event || event.kind !== SESSION_KIND || !hasTag(event, 'd', SESSION_D_TAG)) return null

  const payload = safeJson(event.content)
  return {
    pubkey: event.pubkey,
    type: payload.type ?? 'presence',
    name: normalizePlayerName(payload.name),
    score: Math.max(0, Math.floor(Number(payload.score) || 0)),
    state: payload.state ?? 'lobby',
    jumpY: clampJumpY(payload.jumpY),
    race: payload.race ?? null,
    createdAt: event.created_at ?? 0,
  }
}

export function getBestScores(events, limit = 10) {
  const bestByPubkey = new Map()

  for (const event of events) {
    const score = parseScoreEvent(event)
    if (!score) continue
    const current = bestByPubkey.get(score.pubkey)
    if (!current || score.score > current.score || (score.score === current.score && score.createdAt > current.createdAt)) {
      bestByPubkey.set(score.pubkey, score)
    }
  }

  return [...bestByPubkey.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.createdAt - a.createdAt
    })
    .slice(0, limit)
}

export function serializeEvent(event) {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
}

export function getEventId(event) {
  return bytesToHex(sha256(new TextEncoder().encode(serializeEvent(event))))
}

export function signEvent(event, privkeyHex) {
  const id = getEventId(event)
  const sig = schnorr.sign(hexToBytes(id), hexToBytes(privkeyHex))
  return { ...event, id, sig: bytesToHex(sig) }
}

function normalizeScore(score) {
  return {
    name: normalizePlayerName(score?.name),
    score: Math.max(0, Math.floor(Number(score?.score) || 0)),
    raceId: String(score?.raceId ?? ''),
  }
}

function safeJson(content) {
  try {
    return JSON.parse(content || '{}')
  } catch {
    return {}
  }
}

function findTag(event, key) {
  return event.tags?.find((tag) => tag[0] === key)
}

function hasTag(event, key, value) {
  return event.tags?.some((tag) => tag[0] === key && tag[1] === value)
}

function clampJumpY(value) {
  const y = Math.round(Number(value) || 0)
  return Math.max(-180, Math.min(0, y))
}
