import { describe, expect, it } from 'vitest'
import {
  DINO_X,
  INITIAL_SPEED,
  OBSTACLE_TYPES,
  ROUND_DURATION_SECONDS,
  SPEED_ACCELERATION,
  createRunnerState,
  getRunnerSnapshot,
  isColliding,
  jump,
  obstacleComplexityForX,
  obstacleGapRangeForComplexity,
  stepRunner,
} from '../game/runner.js'

describe('runner simulation', () => {
  it('uses a deterministic obstacle stream from the race seed', () => {
    const first = createRunnerState({ seed: 42 })
    const second = createRunnerState({ seed: 42 })

    expect(first.obstacles.slice(0, 4)).toEqual(second.obstacles.slice(0, 4))
  })

  it('randomizes the colorful obstacle set from the race seed', () => {
    const seenTypes = new Set()

    for (const seed of [1, 2, 3, 4, 5, 42, 99]) {
      for (const obstacle of createRunnerState({ seed }).obstacles) {
        seenTypes.add(obstacle.type)
      }
    }

    expect([...seenTypes].sort()).toEqual(OBSTACLE_TYPES.map((obstacle) => obstacle.type).sort())
  })

  it('advances score and speed while alive', () => {
    const state = stepRunner(createRunnerState({ seed: 1 }), 1)

    expect(state.score).toBeGreaterThan(0)
    expect(state.speed).toBeGreaterThan(INITIAL_SPEED)
    expect(state.alive).toBe(true)
  })

  it('starts with wider obstacle gaps and tightens the range later in the race', () => {
    const early = obstacleGapRangeForComplexity(0)
    const late = obstacleGapRangeForComplexity(1)

    expect(early.min).toBeGreaterThan(late.min)
    expect(early.max).toBeGreaterThan(late.max)
    expect(obstacleComplexityForX(980)).toBe(0)
    expect(obstacleComplexityForX(24_000)).toBeGreaterThan(0.9)
  })

  it('reaches peak complexity well before the 20k distance mark', () => {
    expect(obstacleComplexityForX(15_000)).toBeGreaterThan(0.9)
  })

  it('recovers speed faster than baseline acceleration when below the time-based target', () => {
    const state = {
      ...createRunnerState({ seed: 1 }),
      speed: 150,
      elapsed: 30,
    }
    const next = stepRunner(state, 0.05)
    expect(next.speed - state.speed).toBeGreaterThan(SPEED_ACCELERATION * 0.05)
  })

  it('applies a steep speed cut when the dinosaur hits an obstacle', () => {
    const state = {
      ...createRunnerState({ seed: 1 }),
      speed: 320,
      obstacles: [{ x: DINO_X + 8, width: 28, height: 44, type: 'cactus' }],
    }
    const next = stepRunner(state, 1 / 60)
    expect(next.speed).toBeLessThan(320 * 0.62)
  })

  it('generates more varied spacing than a fixed cactus cadence', () => {
    const state = createRunnerState({ seed: 42 })
    const gaps = state.obstacles.slice(1, 10).map((obstacle, index) => {
      const previous = state.obstacles[index]
      return Math.round(obstacle.x - previous.x - previous.width)
    })

    expect(new Set(gaps).size).toBeGreaterThan(6)
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

  it('slows the dinosaur down on crash instead of ending the run', () => {
    const state = {
      ...createRunnerState({ seed: 1 }),
      speed: 320,
      obstacles: [{ x: DINO_X + 8, width: 28, height: 44, type: 'cactus' }],
    }

    const next = stepRunner(state, 1 / 60)

    expect(next.alive).toBe(true)
    expect(next.finished).toBe(false)
    expect(next.speed).toBeLessThan(320)
    expect(next.crashCooldown).toBeGreaterThan(0)
  })

  it('runs for exactly 60 seconds and then freezes progress', () => {
    let state = createRunnerState({ seed: 1 })

    for (let i = 0; i < (ROUND_DURATION_SECONDS + 1) * 60; i += 1) {
      state = stepRunner(state, 1 / 60)
    }

    const finishedDistance = state.distance
    const afterFinish = stepRunner(state, 1)

    expect(state.finished).toBe(true)
    expect(state.elapsed).toBe(ROUND_DURATION_SECONDS)
    expect(afterFinish.distance).toBe(finishedDistance)
  })

  it.each([1, 7, 42, 99, 12345])(
    'gives a novice jump strategy enough room to stay engaged for 60 seconds with seed %s',
    (seed) => {
      let state = createRunnerState({ seed })
      let elapsed = 0

      for (let i = 0; i < ROUND_DURATION_SECONDS * 60 && !state.finished; i += 1) {
        const nextObstacle = state.obstacles.find((obstacle) => obstacle.x + obstacle.width > DINO_X)
        if (nextObstacle && nextObstacle.x - DINO_X < 132 && state.dino.y === 0) {
          state = jump(state)
        }
        state = stepRunner(state, 1 / 60)
        elapsed += 1 / 60
      }

      expect(elapsed).toBeGreaterThan(59.9)
      expect(state.alive).toBe(true)
      expect(state.finished).toBe(true)
      expect(state.speed).toBeLessThan(560)
    },
  )
})
