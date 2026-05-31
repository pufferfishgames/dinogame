import { normalizePlayerName } from './player.js'

export const PLAYER_COLOR_PALETTE = [
  { body: '#243f32', accent: '#d95f43' },
  { body: '#315a86', accent: '#93d0c2' },
  { body: '#7b3f8f', accent: '#f0c46b' },
  { body: '#9a4d2f', accent: '#35a9b8' },
  { body: '#2f7d6d', accent: '#f08c3a' },
  { body: '#8b2f4f', accent: '#f8d77c' },
  { body: '#4f6f2f', accent: '#d8436f' },
  { body: '#2f4f9a', accent: '#e0b43c' },
  { body: '#7a5a24', accent: '#70c3a2' },
  { body: '#5b4a8f', accent: '#e26845' },
  { body: '#2d6f9e', accent: '#f6d6a5' },
  { body: '#8a3d3d', accent: '#9ad2df' },
]

export function playerColorForName(name) {
  const normalized = normalizePlayerName(name)
  const index = hashName(normalized) % PLAYER_COLOR_PALETTE.length
  return PLAYER_COLOR_PALETTE[index]
}

function hashName(name) {
  let hash = 2166136261
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
