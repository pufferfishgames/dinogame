import { normalizePlayerName } from './player.js'

export const PLAYER_TTL_MS = 10_750
export const COUNTDOWN_MS = 3_000
export const START_EVENT_GRACE_MS = 10_000
export const PLACEMENT_POINTS = [100, 50, 10]
export const FINALIZE_GRACE_MS = 2_500
const MAX_REMOTE_SPEED = 1800

export function mergeNostrUpdate(existing, update, { isPeerConnected = false } = {}) {
  return {
    pubkey: update.pubkey,
    name: update.name,
    score: update.score,
    state: isPeerConnected && existing ? existing.state : update.state,
    jumpY: isPeerConnected && existing ? existing.jumpY : update.jumpY,
    distance: isPeerConnected && existing ? existing.distance : update.distance,
    speed: isPeerConnected && existing ? existing.speed : update.speed,
    elapsed: isPeerConnected && existing ? existing.elapsed : update.elapsed,
  }
}

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
    if ((b.distance ?? 0) !== (a.distance ?? 0)) return (b.distance ?? 0) - (a.distance ?? 0)
    return a.name.localeCompare(b.name)
  })
}

export function awardRacePoints(players) {
  return sortPlayers(players).map((player, index) => ({
    pubkey: player.pubkey,
    name: normalizePlayerName(player.name),
    score: Math.max(0, Math.floor(Number(player.score) || 0)),
    place: index + 1,
    points: PLACEMENT_POINTS[index] ?? 1,
  }))
}

export function canFinalizeRace(
  lobby,
  localPubkey,
  localFinishedAt,
  now = Date.now(),
  graceMs = FINALIZE_GRACE_MS,
) {
  if (!localFinishedAt) return false
  if (activeRacers(lobby, { exceptPubkey: localPubkey }).length === 0) return true
  return now - localFinishedAt >= graceMs
}

export function recordPlayerUpdate(lobby, update, now = Date.now()) {
  if (!update?.pubkey) return lobby
  const score = Math.max(0, Math.floor(Number(update.score) || 0))
  const distance = normalizeDistance(update.distance, score)
  const state = update.state ?? 'lobby'
  const jumpY = clampJumpY(update.jumpY)
  const speed = normalizeSpeed(update.speed)
  const elapsed = normalizeElapsed(update.elapsed)
  const seq = Math.max(0, Math.floor(Number(update.seq) || 0))
  const name = normalizePlayerName(update.name)
  const existing = new Map(lobby.players.map((player) => [player.name, player]))
  let previous = findPlayerByPubkey(lobby.players, update.pubkey)
  const previousSeq = previous?.seqByPubkey?.[update.pubkey] ?? previous?.seq ?? 0
  const previousSeen = previous?.lastSeenByPubkey?.[update.pubkey] ??
    (previous?.pubkey === update.pubkey ? previous?.lastSeen ?? 0 : 0)

  if (seq > 0 && previousSeq >= seq) return lobby
  if (seq === 0 && previousSeen > now) return lobby

  if (previous && previous.name !== name) {
    const nextPrevious = removePubkeyFromPlayer(previous, update.pubkey)
    if (nextPrevious) existing.set(nextPrevious.name, nextPrevious)
    else existing.delete(previous.name)
    previous = null
  }

  const sameNamePlayer = existing.get(name)
  const mergedWith = sameNamePlayer ?? previous
  const appliesVisibleUpdate = !mergedWith || now >= (mergedWith.lastSeen ?? 0)
  const distanceVelocity = deriveDistanceVelocity(mergedWith, {
    distance,
    speed,
    state,
    now,
    appliesVisibleUpdate,
  })

  const pubkeys = mergeUnique([...(mergedWith?.pubkeys ?? [mergedWith?.pubkey]), update.pubkey])
  const nextPlayer = {
    ...mergePlayerProgress(mergedWith, {
      score,
      distance,
      speed,
      distanceVelocity,
      lastSeen: now,
      pubkey: update.pubkey,
    }, { appliesVisibleUpdate }),
    name,
    pubkey: appliesVisibleUpdate ? choosePrimaryPubkey(mergedWith, update.pubkey, now) : mergedWith.pubkey,
    pubkeys,
    state: appliesVisibleUpdate ? state : mergedWith.state,
    jumpY: appliesVisibleUpdate ? jumpY : mergedWith.jumpY,
    elapsed: appliesVisibleUpdate ? elapsed : mergedWith.elapsed,
    seq,
    seqByPubkey: {
      ...(mergedWith?.seqByPubkey ?? (mergedWith?.pubkey ? { [mergedWith.pubkey]: mergedWith.seq ?? 0 } : {})),
      [update.pubkey]: Math.max(previousSeq, seq),
    },
    lastSeenByPubkey: {
      ...(mergedWith?.lastSeenByPubkey ?? (mergedWith?.pubkey ? { [mergedWith.pubkey]: mergedWith.lastSeen ?? now } : {})),
      [update.pubkey]: Math.max(previousSeen, now),
    },
    controlledBy: pubkeys.length,
  }

  existing.set(name, nextPlayer)

  return {
    ...lobby,
    players: sortPlayers([...existing.values()]),
  }
}

function mergePlayerProgress(existing, update, { appliesVisibleUpdate = true } = {}) {
  if (!existing) {
    return {
      score: update.score,
      distance: update.distance,
      speed: update.speed,
      distanceVelocity: update.distanceVelocity,
      lastSeen: update.lastSeen,
    }
  }

  if (!appliesVisibleUpdate) {
    return {
      score: existing.score,
      distance: existing.distance,
      speed: existing.speed,
      distanceVelocity: existing.distanceVelocity,
      lastSeen: existing.lastSeen,
    }
  }

  return {
    score: update.score,
    distance: update.distance,
    speed: update.speed,
    distanceVelocity: update.distanceVelocity,
    lastSeen: update.lastSeen,
  }
}

function deriveDistanceVelocity(existing, { distance, speed, state, now, appliesVisibleUpdate }) {
  if (!appliesVisibleUpdate || state !== 'racing') return existing?.distanceVelocity ?? 0
  if (speed > 0) return speed
  if (!existing?.lastSeen) return 0

  const previousScore = Math.max(0, Math.floor(Number(existing.score) || 0))
  const previousDistance = normalizeDistance(existing.distance, previousScore)
  const elapsedSeconds = (now - existing.lastSeen) / 1000
  if (elapsedSeconds <= 0 || elapsedSeconds > 2) return existing.distanceVelocity ?? 0

  return normalizeSpeed((distance - previousDistance) / elapsedSeconds)
}

function findPlayerByPubkey(players, pubkey) {
  return players.find((player) =>
    player.pubkey === pubkey ||
    player.pubkeys?.includes?.(pubkey) ||
    Object.hasOwn(player.seqByPubkey ?? {}, pubkey),
  )
}

function removePubkeyFromPlayer(player, pubkey) {
  const pubkeys = (player.pubkeys ?? [player.pubkey]).filter((value) => value && value !== pubkey)
  if (!pubkeys.length) return null

  const seqByPubkey = { ...(player.seqByPubkey ?? {}) }
  const lastSeenByPubkey = { ...(player.lastSeenByPubkey ?? {}) }
  delete seqByPubkey[pubkey]
  delete lastSeenByPubkey[pubkey]
  const pubkeyEntries = Object.keys(lastSeenByPubkey).length ? lastSeenByPubkey : Object.fromEntries(pubkeys.map((value) => [value, player.lastSeen ?? 0]))
  const primaryPubkey = pubkeys.reduce((best, value) =>
    (pubkeyEntries[value] ?? 0) >= (pubkeyEntries[best] ?? 0) ? value : best,
  pubkeys[0])

  return {
    ...player,
    pubkey: primaryPubkey,
    pubkeys,
    seqByPubkey,
    lastSeenByPubkey: pubkeyEntries,
    controlledBy: pubkeys.length,
  }
}

function prunePlayerPubkeys(player, now, ttlMs) {
  if (!player.lastSeenByPubkey) {
    return now - player.lastSeen <= ttlMs ? player : null
  }

  const activeEntries = Object.entries(player.lastSeenByPubkey)
    .filter(([, lastSeen]) => now - lastSeen <= ttlMs)
  if (!activeEntries.length) return null

  const activePubkeys = new Set(activeEntries.map(([pubkey]) => pubkey))
  const pubkeys = (player.pubkeys ?? [player.pubkey]).filter((pubkey) => activePubkeys.has(pubkey))
  const lastSeenByPubkey = Object.fromEntries(activeEntries)
  const seqByPubkey = Object.fromEntries(
    Object.entries(player.seqByPubkey ?? {}).filter(([pubkey]) => activePubkeys.has(pubkey)),
  )
  const primaryPubkey = activeEntries.reduce((best, entry) =>
    entry[1] >= best[1] ? entry : best,
  activeEntries[0])[0]
  const lastSeen = Math.max(...activeEntries.map(([, seen]) => seen))

  return {
    ...player,
    pubkey: primaryPubkey,
    pubkeys,
    seqByPubkey,
    lastSeenByPubkey,
    lastSeen,
    controlledBy: pubkeys.length,
  }
}

function choosePrimaryPubkey(existing, pubkey, now) {
  if (!existing) return pubkey
  const currentSeen = existing.lastSeenByPubkey?.[existing.pubkey] ?? existing.lastSeen ?? 0
  return now >= currentSeen ? pubkey : existing.pubkey
}

function mergeUnique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function playerIncludesPubkey(player, pubkey) {
  return Boolean(
    player?.pubkey === pubkey ||
    player?.pubkeys?.includes?.(pubkey) ||
    Object.hasOwn(player?.seqByPubkey ?? {}, pubkey),
  )
}

export function playerNameMatches(player, name) {
  return normalizePlayerName(player?.name) === normalizePlayerName(name)
}

export function findPlayerForPubkeyOrName(players, pubkey, name) {
  return players.find((player) => playerIncludesPubkey(player, pubkey)) ??
    players.find((player) => playerNameMatches(player, name))
}

export function playerIsActiveExcept(player, pubkey) {
  return player.state === 'racing' && !playerIncludesPubkey(player, pubkey)
}

export function playerAwardMatches(award, pubkey, name) {
  return award.pubkey === pubkey || playerNameMatches(award, name)
}

export function mergeLobbyPlayersByName(lobby) {
  let next = { ...lobby, players: [] }
  for (const player of lobby.players) {
    next = recordPlayerUpdate(next, player, player.lastSeen ?? Date.now())
  }
  return next
}

export function prunePlayers(lobby, now = Date.now(), ttlMs = PLAYER_TTL_MS) {
  return {
    ...lobby,
    players: sortPlayers(lobby.players.map((player) => prunePlayerPubkeys(player, now, ttlMs)).filter(Boolean)),
  }
}

export function activeRacers(lobby, { exceptPubkey } = {}) {
  return lobby.players.filter((player) =>
    player.state === 'racing' &&
    !playerIncludesPubkey(player, exceptPubkey),
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

export function shouldIgnoreSessionUpdateForRace(lobby, update, now = Date.now()) {
  const updateRaceId = String(update?.race?.id ?? '')
  if (!updateRaceId || !isRaceScopedSessionUpdate(update)) return false

  const currentRaceId = String(lobby?.race?.id ?? '')
  if (currentRaceId) return updateRaceId !== currentRaceId

  return !shouldApplyRaceStart(lobby, update.race, now)
}

function isRaceScopedSessionUpdate(update) {
  return update?.type === 'start' || ['countdown', 'racing', 'finished'].includes(update?.state)
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
