import { DINO_X } from './runner.js'
import { normalizePlayerName } from './player.js'

const REMOTE_DINO_WIDTH = 38
const TRACK_WIDTH = 920
const BASE_Y = 238
const LANE_OFFSETS = [0, -24, 20, -42, 38, -60, 56]

export function buildRemotePlayerSprites({
  players,
  localPubkey,
  localScore = 0,
  localDistance,
  trackWidth = TRACK_WIDTH,
} = {}) {
  const localProgress = normalizeDistance(localDistance, localScore)
  const hasLocalDistance = Number.isFinite(Number(localDistance))

  return [...(players ?? [])]
    .filter((player) => player?.pubkey && player.pubkey !== localPubkey)
    .map((player, index) => {
      const score = Math.max(0, Math.floor(Number(player.score) || 0))
      const hasExactDistance = hasLocalDistance || Number.isFinite(Number(player.distance))
      const distance = normalizeDistance(player.distance, score)
      const progressDelta = distance - localProgress
      const laneOffset = LANE_OFFSETS[index % LANE_OFFSETS.length]
      const jumpY = clampJumpY(player.jumpY)
      const x = DINO_X + progressDelta

      return {
        pubkey: player.pubkey,
        name: normalizePlayerName(player.name),
        score,
        distance,
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
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clampJumpY(value) {
  const y = Math.round(Number(value) || 0)
  return Math.max(-180, Math.min(0, y))
}

function normalizeDistance(distance, score = 0) {
  const value = Number(distance)
  if (Number.isFinite(value)) return Math.max(0, value)
  return Math.max(0, Math.floor(Number(score) || 0) * 10)
}
