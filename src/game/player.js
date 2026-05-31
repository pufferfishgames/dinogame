export const MAX_PLAYER_NAME_LENGTH = 7

export function normalizePlayerName(value, fallback = 'GUEST') {
  const clean = normalizeEditablePlayerName(value)

  return clean || fallback
}

export function normalizeEditablePlayerName(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_PLAYER_NAME_LENGTH)
}
