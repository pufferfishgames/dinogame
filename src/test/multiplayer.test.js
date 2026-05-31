import { describe, expect, it } from 'vitest'
import {
  createLobbyState,
  prunePlayers,
  recordPlayerUpdate,
  startRace,
} from '../game/multiplayer.js'

describe('multiplayer lobby', () => {
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
})
