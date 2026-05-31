import { normalizePlayerName } from './player.js'

export const PLAYER_COLOR_PALETTE = [
  { body: '#c03028', accent: '#28c8a0' },  // crimson + seafoam
  { body: '#c85518', accent: '#2898e0' },  // burnt orange + sky blue
  { body: '#b89000', accent: '#8040d0' },  // amber gold + purple
  { body: '#5c9810', accent: '#d040c0' },  // lime green + fuchsia
  { body: '#1a8c42', accent: '#e07020' },  // forest green + tangerine
  { body: '#108888', accent: '#e8d010' },  // teal + vivid yellow
  { body: '#1470c8', accent: '#f0a810' },  // azure blue + amber
  { body: '#4828b0', accent: '#40d870' },  // indigo + lime
  { body: '#7820a8', accent: '#30d8c8' },  // violet + turquoise
  { body: '#b81478', accent: '#28d0e0' },  // magenta + cyan
  { body: '#c02050', accent: '#28d890' },  // rose red + emerald
  { body: '#1a40c8', accent: '#e05828' },  // cobalt blue + coral
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
