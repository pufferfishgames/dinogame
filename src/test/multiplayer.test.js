import { describe, expect, it } from 'vitest'
import {
  activeRacers,
  canStartRace,
  createLobbyState,
  awardRacePoints,
  canFinalizeRace,
  mergeNostrUpdate,
  prunePlayers,
  raceStartControl,
  recordPlayerUpdate,
  shouldApplyRaceStart,
  startRace,
} from '../game/multiplayer.js'

describe('multiplayer lobby', () => {
  it('preserves WebRTC position state when a stale Nostr update arrives for a connected peer', () => {
    const existing = { state: 'racing', jumpY: -80, distance: 1_200 }
    const nostrUpdate = { pubkey: 'a', name: 'ALICE', score: 100, state: 'lobby', jumpY: 0, distance: 1_000 }
    const merged = mergeNostrUpdate(existing, nostrUpdate, { isPeerConnected: true })
    expect(merged.state).toBe('racing')
    expect(merged.jumpY).toBe(-80)
    expect(merged.distance).toBe(1_200)
    expect(merged.name).toBe('ALICE')
    expect(merged.score).toBe(100)
  })

  it('applies Nostr update when no WebRTC peer is connected', () => {
    const nostrUpdate = { pubkey: 'a', name: 'ALICE', score: 100, state: 'lobby', jumpY: 0 }
    const merged = mergeNostrUpdate(null, nostrUpdate, { isPeerConnected: false })
    expect(merged.state).toBe('lobby')
    expect(merged.jumpY).toBe(0)
  })

  it('stores exact distance and uses it to break score ties', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 100, distance: 1_004 }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 100, distance: 1_043 }, 1000)

    expect(lobby.players.map((player) => [player.name, player.distance])).toEqual([
      ['BOB', 1_043],
      ['ALICE', 1_004],
    ])
  })

  it('allows the start button to launch a single-player race', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 0 }, 1000)

    const result = startRace(lobby, 'a', 1000)

    expect(result.started).toBe(true)
    expect(result.lobby.phase).toBe('countdown')
    expect(result.lobby.race.startedBy).toBe('a')
  })

  it('can still enforce a two-player competition minimum', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 0 }, 1000)

    expect(startRace(lobby, 'a', 1000, { minPlayers: 2 })).toEqual({ lobby, started: false })

    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 0 }, 1200)

    expect(startRace(lobby, 'b', 2000, { minPlayers: 2 }).started).toBe(true)
  })

  it('sorts competitors by score and removes stale players', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 200 }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 500 }, 1200)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'c', name: 'CARA', score: 300 }, 1300)

    expect(lobby.players.map((player) => player.name)).toEqual(['BOB', 'CARA', 'ALICE'])
    expect(prunePlayers(lobby, 12000).players.map((player) => player.name)).toEqual(['CARA'])
  })

  it('does not let a crashed player restart while another player is still racing', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 320, state: 'crashed' }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 600, state: 'racing' }, 1000)
    lobby = { ...lobby, phase: 'racing', race: { id: 'race-1', seed: 1, startedBy: 'a', startAt: 0 } }

    expect(activeRacers(lobby, { exceptPubkey: 'a' }).map((player) => player.name)).toEqual(['BOB'])
    expect(canStartRace(lobby, 'a')).toBe(false)
    expect(startRace(lobby, 'a', 2000).started).toBe(false)
  })

  it('allows the next race after all other competitors have stopped racing', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 320, state: 'crashed' }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 600, state: 'crashed' }, 1000)
    lobby = { ...lobby, phase: 'racing', race: { id: 'race-1', seed: 1, startedBy: 'a', startAt: 0 } }

    expect(canStartRace(lobby, 'a')).toBe(true)
    expect(startRace(lobby, 'a', 2000).started).toBe(true)
  })

  it('keeps the crashed player waiting while another competitor continues', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 320, state: 'crashed' }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 600, state: 'racing' }, 1000)
    lobby = { ...lobby, phase: 'racing', race: { id: 'race-1', seed: 1, startedBy: 'a', startAt: 0 } }

    expect(raceStartControl(lobby, 'a', { joined: true, runnerAlive: false })).toEqual({
      canStart: false,
      label: 'Waiting',
    })
  })

  it('does not offer a next race while the local player is still alive', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 320, state: 'racing' }, 1000)
    lobby = { ...lobby, phase: 'racing', race: { id: 'race-1', seed: 1, startedBy: 'a', startAt: 0 } }

    expect(raceStartControl(lobby, 'a', { joined: true, runnerAlive: true })).toEqual({
      canStart: false,
      label: 'Racing',
    })
  })

  it('ignores stale relay start events so opening the page does not auto-start an old race', () => {
    const lobby = createLobbyState()

    expect(shouldApplyRaceStart(lobby, { id: 'old-race', startAt: 10_000 }, 130_000)).toBe(false)
    expect(shouldApplyRaceStart(lobby, { id: 'fresh-race', startAt: 126_000 }, 130_000)).toBe(true)
  })

  it('awards final race points by placement', () => {
    const awards = awardRacePoints([
      { pubkey: 'a', name: 'ALICE', score: 930 },
      { pubkey: 'b', name: 'BOB', score: 1100 },
      { pubkey: 'c', name: 'CARA', score: 820 },
      { pubkey: 'd', name: 'DREW', score: 700 },
      { pubkey: 'e', name: 'ELI', score: 100 },
    ])

    expect(awards.map((award) => [award.name, award.place, award.points])).toEqual([
      ['BOB', 1, 100],
      ['ALICE', 2, 50],
      ['CARA', 3, 10],
      ['DREW', 4, 1],
      ['ELI', 5, 1],
    ])
  })

  it('waits for other active racers before finalizing placement points', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 930, state: 'finished' }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 1100, state: 'racing' }, 1000)
    lobby = { ...lobby, phase: 'racing' }

    expect(canFinalizeRace(lobby, 'a', 30_000, 31_000)).toBe(false)
    expect(canFinalizeRace(lobby, 'a', 30_000, 33_000)).toBe(true)
  })

  it('finalizes immediately when all known competitors have finished', () => {
    let lobby = createLobbyState()
    lobby = recordPlayerUpdate(lobby, { pubkey: 'a', name: 'ALICE', score: 930, state: 'finished' }, 1000)
    lobby = recordPlayerUpdate(lobby, { pubkey: 'b', name: 'BOB', score: 1100, state: 'finished' }, 1000)
    lobby = { ...lobby, phase: 'racing' }

    expect(canFinalizeRace(lobby, 'a', 30_000, 30_100)).toBe(true)
  })
})
