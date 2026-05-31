import { DINO_X } from './runner.js'
import { normalizePlayerName } from './player.js'
import { playerColorForName } from './playerColors.js'

const REMOTE_DINO_WIDTH = 38
const TRACK_WIDTH = 920
const BASE_Y = 238
const LANE_OFFSETS = [0, -24, 20, -42, 38, -60, 56]
const MAX_PREDICTION_MS = 900
const SMALL_CORRECTION_SCREEN_RATIO = 1 / 20
const SMOOTH_CORRECTION_SECONDS = 0.10
const MAX_REMOTE_SPEED = 1800

export function buildRemotePlayerSprites({
  players,
  localPubkey,
  localName,
  localScore = 0,
  localDistance,
  localElapsed,
  trackWidth = TRACK_WIDTH,
  now = Date.now(),
  smoothingState,
} = {}) {
  const localProgress = normalizeDistance(localDistance, localScore)
  const hasLocalDistance = Number.isFinite(Number(localDistance))
  const localElapsedValue = normalizeElapsed(localElapsed)
  const normalizedLocalName = normalizePlayerName(localName)
  const activeSmoothingKeys = new Set()

  const sprites = [...(players ?? [])]
    .filter((player) =>
      player?.pubkey &&
      !playerIncludesPubkey(player, localPubkey) &&
      normalizePlayerName(player.name) !== normalizedLocalName,
    )
    .map((player, index) => {
      const score = Math.max(0, Math.floor(Number(player.score) || 0))
      const hasExactDistance = hasLocalDistance || Number.isFinite(Number(player.distance))
      const observedDistance = normalizeDistance(player.distance, score)
      const projectedDistance = predictDistance(player, {
        observedDistance,
        score,
        localElapsed: localElapsedValue,
        now,
      })
      const smoothingKey = normalizePlayerName(player.name)
      activeSmoothingKeys.add(smoothingKey)
      const distance = smoothDistance(smoothingState, smoothingKey, {
        targetDistance: projectedDistance,
        baseVelocity: normalizeSpeed(player.distanceVelocity ?? player.speed),
        state: player.state ?? 'lobby',
        now,
        trackWidth,
      })
      const progressDelta = distance - localProgress
      const laneOffset = LANE_OFFSETS[index % LANE_OFFSETS.length]
      const jumpY = clampJumpY(player.jumpY)
      const x = DINO_X + progressDelta
      const colors = playerColorForName(player.name)

      return {
        pubkey: player.pubkey,
        name: normalizePlayerName(player.name),
        color: colors.body,
        accent: colors.accent,
        score,
        distance,
        observedDistance,
        projectedDistance,
        state: player.state ?? 'lobby',
        hasExactDistance,
        x: hasExactDistance ? x : clamp(x, 24, trackWidth - REMOTE_DINO_WIDTH - 20),
        y: BASE_Y + laneOffset + jumpY,
        jumpY,
        width: REMOTE_DINO_WIDTH,
        height: 42,
      }
    })
    .filter((sprite) =>
      !sprite.hasExactDistance ||
      (sprite.x + sprite.width >= 0 && sprite.x <= trackWidth),
    )
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.distance !== a.distance) return b.distance - a.distance
      return a.name.localeCompare(b.name)
    })

  pruneSmoothingState(smoothingState, activeSmoothingKeys)
  return sprites
}

function predictDistance(player, { observedDistance, score, localElapsed, now }) {
  if ((player.state ?? 'lobby') !== 'racing') return observedDistance

  const speed = normalizeSpeed(player.distanceVelocity ?? player.speed)
  if (speed <= 0) return observedDistance

  const elapsed = normalizeElapsed(player.elapsed)
  const elapsedLeadMs = localElapsed > 0 && elapsed > 0
    ? Math.max(0, (localElapsed - elapsed) * 1000)
    : 0
  const receivedLeadMs = Math.max(0, Number(now) - Number(player.lastSeen || now))
  const predictionMs = Math.min(MAX_PREDICTION_MS, Math.max(elapsedLeadMs, receivedLeadMs))

  return normalizeDistance(observedDistance + speed * predictionMs / 1000, score)
}

function smoothDistance(smoothingState, key, {
  targetDistance,
  baseVelocity,
  state,
  now,
  trackWidth,
}) {
  if (!smoothingState || state !== 'racing') {
    smoothingState?.set?.(key, {
      distance: targetDistance,
      velocity: baseVelocity,
      updatedAt: now,
    })
    return targetDistance
  }

  const previous = smoothingState.get(key)
  if (!previous) {
    smoothingState.set(key, {
      distance: targetDistance,
      velocity: baseVelocity,
      updatedAt: now,
    })
    return targetDistance
  }

  const dt = clamp((Number(now) - Number(previous.updatedAt || now)) / 1000, 0, 0.12)
  const predictedDistance = previous.distance + previous.velocity * dt
  const correction = targetDistance - predictedDistance
  const smallCorrectionLimit = trackWidth * SMALL_CORRECTION_SCREEN_RATIO

  if (Math.abs(correction) > smallCorrectionLimit) {
    smoothingState.set(key, {
      distance: targetDistance,
      velocity: baseVelocity,
      updatedAt: now,
    })
    return targetDistance
  }

  const correctionVelocity = correction / SMOOTH_CORRECTION_SECONDS
  const velocity = clamp(baseVelocity + correctionVelocity, 0, MAX_REMOTE_SPEED)
  smoothingState.set(key, {
    distance: predictedDistance,
    velocity,
    updatedAt: now,
  })
  return predictedDistance
}

function pruneSmoothingState(smoothingState, activeKeys) {
  if (!smoothingState?.keys) return
  for (const key of smoothingState.keys()) {
    if (!activeKeys.has(key)) smoothingState.delete(key)
  }
}

function playerIncludesPubkey(player, pubkey) {
  return Boolean(
    player?.pubkey === pubkey ||
    player?.pubkeys?.includes?.(pubkey) ||
    Object.hasOwn(player?.seqByPubkey ?? {}, pubkey),
  )
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clampJumpY(value) {
  const y = Math.round(Number(value) || 0)
  return Math.max(-180, Math.min(0, y))
}

function normalizeSpeed(speed) {
  const value = Number(speed)
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_REMOTE_SPEED, value)) : 0
}

function normalizeElapsed(elapsed) {
  const value = Number(elapsed)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeDistance(distance, score = 0) {
  const value = Number(distance)
  if (Number.isFinite(value)) return Math.max(0, value)
  return Math.max(0, Math.floor(Number(score) || 0) * 10)
}
