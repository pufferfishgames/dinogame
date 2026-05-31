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
  trackWidth = TRACK_WIDTH,
} = {}) {
  return [...(players ?? [])]
    .filter((player) => player?.pubkey && player.pubkey !== localPubkey)
    .map((player, index) => {
      const score = Math.max(0, Math.floor(Number(player.score) || 0))
      const progressDelta = score - Math.max(0, Math.floor(Number(localScore) || 0))
      const laneOffset = LANE_OFFSETS[index % LANE_OFFSETS.length]
      const stagger = (index % 3) * 18
      const jumpY = clampJumpY(player.jumpY)

      return {
        pubkey: player.pubkey,
        name: normalizePlayerName(player.name),
        score,
        state: player.state ?? 'lobby',
        x: clamp(DINO_X + 78 + progressDelta * 1.35 + stagger, 24, trackWidth - REMOTE_DINO_WIDTH - 20),
        y: BASE_Y + laneOffset + jumpY,
        jumpY,
        width: REMOTE_DINO_WIDTH,
        height: 42,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
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
