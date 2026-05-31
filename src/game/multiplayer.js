import { normalizePlayerName } from './player.js'

export const PLAYER_TTL_MS = 10_750
export const COUNTDOWN_MS = 3_000
export const START_EVENT_GRACE_MS = 10_000

export function createLobbyState() {
  return {
    phase: 'idle',
    players: [],
    race: null,
  }
}

export function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0)
    return a.name.localeCompare(b.name)
  })
}

export function recordPlayerUpdate(lobby, update, now = Date.now()) {
  if (!update?.pubkey) return lobby

  const nextPlayer = {
    pubkey: update.pubkey,
    name: normalizePlayerName(update.name),
    score: Math.max(0, Math.floor(Number(update.score) || 0)),
    state: update.state ?? 'lobby',
    jumpY: clampJumpY(update.jumpY),
    lastSeen: now,
  }

  const existing = new Map(lobby.players.map((player) => [player.pubkey, player]))
  existing.set(nextPlayer.pubkey, { ...existing.get(nextPlayer.pubkey), ...nextPlayer })

  return {
    ...lobby,
    players: sortPlayers([...existing.values()]),
  }
}

export function prunePlayers(lobby, now = Date.now(), ttlMs = PLAYER_TTL_MS) {
  return {
    ...lobby,
    players: sortPlayers(lobby.players.filter((player) => now - player.lastSeen <= ttlMs)),
  }
}

export function activeRacers(lobby, { exceptPubkey } = {}) {
  return lobby.players.filter((player) =>
    player.state === 'racing' &&
    player.pubkey !== exceptPubkey,
  )
}

export function canStartRace(lobby, starterPubkey, { minPlayers = 1 } = {}) {
  if (lobby.players.length < minPlayers) return false
  if (lobby.phase === 'countdown') return false
  return activeRacers(lobby, { exceptPubkey: starterPubkey }).length === 0
}

export function raceStartControl(lobby, starterPubkey, { joined = false, runnerAlive = false } = {}) {
  const canStart =
    joined &&
    (lobby.phase !== 'racing' || !runnerAlive) &&
    canStartRace(lobby, starterPubkey)

  if (lobby.phase === 'racing') {
    return {
      canStart,
      label: canStart ? 'Next' : runnerAlive ? 'Racing' : 'Waiting',
    }
  }

  return {
    canStart,
    label: 'Start',
  }
}

export function shouldApplyRaceStart(lobby, race, now = Date.now(), graceMs = START_EVENT_GRACE_MS) {
  if (!race?.id || lobby.race?.id === race.id) return false
  const startAt = Number(race.startAt)
  if (!Number.isFinite(startAt)) return false
  return startAt >= now - graceMs
}

export function startRace(lobby, starterPubkey, now = Date.now(), { minPlayers = 1 } = {}) {
  if (!canStartRace(lobby, starterPubkey, { minPlayers })) return { lobby, started: false }

  const race = {
    id: `${now}-${String(starterPubkey).slice(0, 10)}`,
    seed: makeRaceSeed(starterPubkey, now),
    startedBy: starterPubkey,
    startAt: now + COUNTDOWN_MS,
  }

  return {
    started: true,
    lobby: {
      ...lobby,
      phase: 'countdown',
      race,
    },
  }
}

export function applyRace(lobby, race, now = Date.now()) {
  if (!race?.id) return lobby

  return {
    ...lobby,
    phase: now >= race.startAt ? 'racing' : 'countdown',
    race: {
      id: String(race.id),
      seed: Number(race.seed) || 1,
      startedBy: String(race.startedBy ?? ''),
      startAt: Number(race.startAt) || now,
    },
  }
}

export function makeRaceSeed(value, now = Date.now()) {
  const text = `${value}:${now}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function clampJumpY(value) {
  const y = Math.round(Number(value) || 0)
  return Math.max(-180, Math.min(0, y))
}
