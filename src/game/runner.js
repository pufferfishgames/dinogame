export const DINO_X = 96
export const GROUND_Y = 0
export const INITIAL_SPEED = 240
export const SPEED_ACCELERATION = 4
export const FIRST_OBSTACLE_X = 980

const GRAVITY = 2200
const JUMP_VELOCITY = -820
const DINO_WIDTH = 44
const DINO_HEIGHT = 48
const MIN_OBSTACLE_GAP = 460
const MAX_OBSTACLE_GAP = 760
const TRACK_WIDTH = 920

const OBSTACLE_TYPES = [
  { type: 'cactus', width: 28, height: 44 },
  { type: 'double-cactus', width: 46, height: 36 },
  { type: 'rock', width: 34, height: 24 },
  { type: 'tall-cactus', width: 32, height: 58 },
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
    distance: 0,
    score: 0,
    speed: INITIAL_SPEED,
    alive: true,
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
  if (!state.alive || state.dino.y !== GROUND_Y) return state

  return {
    ...state,
    dino: {
      ...state.dino,
      vy: JUMP_VELOCITY,
    },
  }
}

export function stepRunner(state, dt) {
  if (!state.alive) return state

  const cappedDt = Math.max(0, Math.min(Number(dt) || 0, 0.05))
  const speed = state.speed + SPEED_ACCELERATION * cappedDt
  const distance = state.distance + speed * cappedDt
  const score = Math.floor(distance / 10)

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

  const next = {
    ...state,
    randomSeed,
    nextX,
    distance,
    score,
    speed,
    dino: {
      ...state.dino,
      y,
      vy,
    },
    obstacles,
  }

  const alive = !obstacles.some((obstacle) => isColliding(getRunnerSnapshot(next), obstacle))
  return { ...next, alive }
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
  const gap = MIN_OBSTACLE_GAP + random.value * (MAX_OBSTACLE_GAP - MIN_OBSTACLE_GAP)

  return {
    seed: random.seed,
    nextX: x + type.width + gap,
    obstacle: {
      ...type,
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
