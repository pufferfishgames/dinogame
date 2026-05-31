export const DINO_X = 96
export const GROUND_Y = 0
export const INITIAL_SPEED = 240
export const SPEED_ACCELERATION = 5
export const FIRST_OBSTACLE_X = 980
export const ROUND_DURATION_SECONDS = 60
export const CRASH_SLOWDOWN_FACTOR = 0.68
export const CRASH_COOLDOWN_SECONDS = 0.75

const GRAVITY = 2200
const JUMP_VELOCITY = -820
const DINO_WIDTH = 44
const DINO_HEIGHT = 48
const MIN_OBSTACLE_GAP = 390
const MAX_OBSTACLE_GAP = 690
const TRACK_WIDTH = 920

export const OBSTACLE_TYPES = [
  { type: 'cactus', width: 30, height: 50 },
  { type: 'turtle', width: 52, height: 28 },
  { type: 'mushroom', width: 38, height: 38 },
  { type: 'puddle', width: 64, height: 14 },
]

export function createRunnerState({ seed = 1 } = {}) {
  let randomSeed = seed >>> 0 || 1
  let nextX = FIRST_OBSTACLE_X
  const obstacles = []

  for (let i = 0; i < 24; i += 1) {
    const generated = generateObstacle(randomSeed, nextX)
    randomSeed = generated.seed
    nextX = generated.nextX
    obstacles.push(generated.obstacle)
  }

  return {
    seed: seed >>> 0 || 1,
    randomSeed,
    nextX,
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

  let speed = state.speed + SPEED_ACCELERATION * cappedDt
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
  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * cappedDt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -40)

  while ((obstacles.at(-1)?.x ?? 0) < TRACK_WIDTH) {
    const generated = generateObstacle(randomSeed, nextX)
    randomSeed = generated.seed
    nextX = generated.nextX
    obstacles = [...obstacles, generated.obstacle]
  }

  let elapsed = Math.min(ROUND_DURATION_SECONDS, (state.elapsed ?? 0) + cappedDt)
  const finished = elapsed >= ROUND_DURATION_SECONDS - 1e-6
  if (finished) elapsed = ROUND_DURATION_SECONDS

  const next = {
    ...state,
    randomSeed,
    nextX,
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

function generateObstacle(seed, x) {
  let random = nextRandom(seed)
  const type = OBSTACLE_TYPES[Math.floor(random.value * OBSTACLE_TYPES.length)]
  random = nextRandom(random.seed)
  const variant = Math.floor(random.value * 4)
  random = nextRandom(random.seed)
  const gap = MIN_OBSTACLE_GAP + random.value * (MAX_OBSTACLE_GAP - MIN_OBSTACLE_GAP)

  return {
    seed: random.seed,
    nextX: x + type.width + gap,
    obstacle: {
      ...type,
      variant,
      x,
    },
  }
}

function nextRandom(seed) {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return {
    seed: next,
    value: next / 0x100000000,
  }
}
