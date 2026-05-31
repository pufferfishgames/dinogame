export const DINO_X = 96
export const GROUND_Y = 0
export const INITIAL_SPEED = 240
export const SPEED_ACCELERATION = 7
export const CRASH_RECOVERY_ACCELERATION = 36
export const FIRST_OBSTACLE_X = 980
export const ROUND_DURATION_SECONDS = 60
export const CRASH_SLOWDOWN_FACTOR = 0.55
export const CRASH_COOLDOWN_SECONDS = 0.75

const GRAVITY = 2200
const JUMP_VELOCITY = -820
const DINO_WIDTH = 44
const DINO_HEIGHT = 48
const EARLY_MIN_OBSTACLE_GAP = 500
const EARLY_MAX_OBSTACLE_GAP = 1000
const LATE_MIN_OBSTACLE_GAP = 200
const LATE_MAX_OBSTACLE_GAP = 580
const MAX_GAP_JITTER = 240
const COMPLEXITY_DISTANCE = 14_000
const TRACK_WIDTH = 920

export const OBSTACLE_TYPES = [
  { type: 'cactus', width: 30, height: 50 },
  { type: 'tortoise', width: 52, height: 28 },
  { type: 'mushroom', width: 38, height: 38 },
  { type: 'puddle', width: 64, height: 14 },
  { type: 'crocodile', width: 76, height: 24 },
  { type: 'chair', width: 42, height: 46 },
  { type: 'pine-tree', width: 48, height: 62 },
]

export function createRunnerState({ seed = 1 } = {}) {
  let randomSeed = seed >>> 0 || 1
  let nextX = FIRST_OBSTACLE_X
  let lastObstacleType = ''
  const obstacles = []

  for (let i = 0; i < 24; i += 1) {
    const generated = generateObstacle(randomSeed, nextX, i, lastObstacleType)
    randomSeed = generated.seed
    nextX = generated.nextX
    lastObstacleType = generated.obstacle.type
    obstacles.push(generated.obstacle)
  }

  return {
    seed: seed >>> 0 || 1,
    randomSeed,
    nextX,
    lastObstacleType,
    obstacleCount: obstacles.length,
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: INITIAL_SPEED,
    alive: true,
    finished: false,
    crashCooldown: 0,
    dino: {
      y: GROUND_Y,
      vy: 0,
      width: DINO_WIDTH,
      height: DINO_HEIGHT,
    },
    obstacles,
  }
}

export function jump(state) {
  if (!state.alive || state.finished || state.dino.y !== GROUND_Y) return state

  return {
    ...state,
    dino: {
      ...state.dino,
      vy: JUMP_VELOCITY,
    },
  }
}

export function stepRunner(state, dt) {
  if (!state.alive || state.finished) return state

  const requestedDt = Math.max(0, Math.min(Number(dt) || 0, 0.05))
  const remaining = Math.max(0, ROUND_DURATION_SECONDS - (state.elapsed ?? 0))
  const cappedDt = Math.min(requestedDt, remaining)
  if (cappedDt <= 0) return { ...state, elapsed: ROUND_DURATION_SECONDS, finished: true }

  const targetSpeed = INITIAL_SPEED + SPEED_ACCELERATION * (state.elapsed ?? 0)
  const accel = state.speed < targetSpeed ? CRASH_RECOVERY_ACCELERATION : SPEED_ACCELERATION
  let speed = state.speed + accel * cappedDt
  const distance = state.distance + speed * cappedDt
  const score = Math.floor(distance / 10)
  const crashCooldown = Math.max(0, (state.crashCooldown ?? 0) - cappedDt)

  let y = state.dino.y + state.dino.vy * cappedDt
  let vy = state.dino.vy + GRAVITY * cappedDt
  if (y >= GROUND_Y) {
    y = GROUND_Y
    vy = 0
  }

  let randomSeed = state.randomSeed
  let nextX = state.nextX
  let lastObstacleType = state.lastObstacleType ?? state.obstacles.at(-1)?.type ?? ''
  let obstacleCount = state.obstacleCount ?? state.obstacles.length
  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * cappedDt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -40)

  while ((obstacles.at(-1)?.x ?? 0) < TRACK_WIDTH) {
    const generated = generateObstacle(randomSeed, nextX, obstacleCount, lastObstacleType)
    randomSeed = generated.seed
    nextX = generated.nextX
    lastObstacleType = generated.obstacle.type
    obstacleCount += 1
    obstacles = [...obstacles, { ...generated.obstacle, x: generated.obstacle.x - distance }]
  }
  obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.width > -40)

  let elapsed = Math.min(ROUND_DURATION_SECONDS, (state.elapsed ?? 0) + cappedDt)
  const finished = elapsed >= ROUND_DURATION_SECONDS - 1e-6
  if (finished) elapsed = ROUND_DURATION_SECONDS

  const next = {
    ...state,
    randomSeed,
    nextX,
    lastObstacleType,
    obstacleCount,
    elapsed,
    distance,
    score,
    speed,
    crashCooldown,
    dino: {
      ...state.dino,
      y,
      vy,
    },
    obstacles,
  }

  const collided = crashCooldown <= 0 && obstacles.some((obstacle) => isColliding(getRunnerSnapshot(next), obstacle))
  if (collided) {
    speed = Math.max(INITIAL_SPEED * 0.55, speed * CRASH_SLOWDOWN_FACTOR)
  }

  return {
    ...next,
    speed,
    alive: true,
    finished,
    crashCooldown: collided ? CRASH_COOLDOWN_SECONDS : crashCooldown,
  }
}

export function getRunnerSnapshot(state) {
  return {
    dino: {
      x: DINO_X,
      y: state.dino.y,
      width: state.dino.width,
      height: state.dino.height,
    },
    score: state.score,
    speed: state.speed,
    distance: state.distance,
    alive: state.alive,
    finished: state.finished,
  }
}

export function isColliding(snapshot, obstacle) {
  const dino = snapshot.dino
  const horizontal =
    dino.x < obstacle.x + obstacle.width &&
    dino.x + dino.width > obstacle.x

  if (!horizontal) return false

  const dinoBottom = -dino.y
  const dinoTop = dinoBottom + dino.height
  const obstacleBottom = 0
  const obstacleTop = obstacle.height

  return dinoBottom < obstacleTop && dinoTop > obstacleBottom
}

export function obstacleComplexityForX(x) {
  return clamp((x - FIRST_OBSTACLE_X) / COMPLEXITY_DISTANCE, 0, 1)
}

export function obstacleGapRangeForComplexity(complexity) {
  const level = clamp(complexity, 0, 1)
  return {
    min: lerp(EARLY_MIN_OBSTACLE_GAP, LATE_MIN_OBSTACLE_GAP, level),
    max: lerp(EARLY_MAX_OBSTACLE_GAP, LATE_MAX_OBSTACLE_GAP, level),
  }
}

export function estimateFinishDistance({
  distance = 0,
  speed = INITIAL_SPEED,
  elapsed = 0,
} = {}) {
  const remaining = Math.max(0, ROUND_DURATION_SECONDS - (Number(elapsed) || 0))
  const currentDistance = Math.max(0, Number(distance) || 0)
  const currentSpeed = Math.max(0, Number(speed) || 0)
  return currentDistance + currentSpeed * remaining + 0.5 * SPEED_ACCELERATION * remaining * remaining
}

function generateObstacle(seed, x, index = 0, previousType = '') {
  let random = nextRandom(seed)
  const complexity = Math.max(obstacleComplexityForX(x), clamp(index / 46, 0, 1))
  const type = pickObstacleType(random.value, complexity, previousType)
  random = nextRandom(random.seed)
  const variant = Math.floor(random.value * 8)
  random = nextRandom(random.seed)
  const range = obstacleGapRangeForComplexity(complexity)
  let gap = range.min + random.value * (range.max - range.min)
  random = nextRandom(random.seed)
  gap += (random.value - 0.5) * MAX_GAP_JITTER
  random = nextRandom(random.seed)
  gap += (random.value - 0.5) * MAX_GAP_JITTER * 0.35
  gap = clamp(gap, LATE_MIN_OBSTACLE_GAP, EARLY_MAX_OBSTACLE_GAP)

  return {
    seed: random.seed,
    nextX: x + type.width + gap,
    obstacle: {
      ...type,
      complexity,
      variant,
      motionOffset: random.value,
      x,
    },
  }
}

function pickObstacleType(value, complexity, previousType = '') {
  const late = clamp(complexity, 0, 1)
  const weights = [
    [OBSTACLE_TYPES[0], 0.24 + late * 0.06],
    [OBSTACLE_TYPES[1], 0.18 + late * 0.08],
    [OBSTACLE_TYPES[2], 0.20 - late * 0.03],
    [OBSTACLE_TYPES[3], 0.13 - late * 0.02],
    [OBSTACLE_TYPES[4], 0.09 + late * 0.09],
    [OBSTACLE_TYPES[5], 0.13],
    [OBSTACLE_TYPES[6], 0.10 + late * 0.04],
  ].map(([obstacle, weight]) => [
    obstacle,
    obstacle.type === previousType ? 0 : weight,
  ])
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let threshold = value * total

  for (const [obstacle, weight] of weights) {
    threshold -= weight
    if (threshold <= 0) return obstacle
  }

  return OBSTACLE_TYPES.at(-1)
}

function lerp(start, end, amount) {
  return start + (end - start) * amount
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function nextRandom(seed) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return {
    seed: next,
    value: next / 0x100000000,
  }
}
