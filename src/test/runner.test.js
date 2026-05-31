import { describe, expect, it } from 'vitest'
import {
  DINO_X,
  createRunnerState,
  getRunnerSnapshot,
  isColliding,
  jump,
  stepRunner,
} from '../game/runner.js'

describe('runner simulation', () => {
  it('uses a deterministic obstacle stream from the race seed', () => {
    const first = createRunnerState({ seed: 42 })
    const second = createRunnerState({ seed: 42 })

    expect(first.obstacles.slice(0, 4)).toEqual(second.obstacles.slice(0, 4))
  })

  it('advances score and speed while alive', () => {
    const state = stepRunner(createRunnerState({ seed: 1 }), 1)

    expect(state.score).toBeGreaterThan(0)
    expect(state.speed).toBeGreaterThan(360)
    expect(state.alive).toBe(true)
  })

  it('lets the dinosaur jump and land', () => {
    let state = jump(createRunnerState({ seed: 1 }))
    expect(state.dino.vy).toBeLessThan(0)

    for (let i = 0; i < 70; i += 1) state = stepRunner(state, 1 / 60)

    expect(state.dino.y).toBe(0)
    expect(state.dino.vy).toBe(0)
  })

  it('detects obstacle collisions at the dinosaur lane', () => {
    const obstacle = { x: DINO_X + 8, width: 28, height: 44, type: 'cactus' }

    expect(isColliding(getRunnerSnapshot(createRunnerState()), obstacle)).toBe(true)
  })
})
