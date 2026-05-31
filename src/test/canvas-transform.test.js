import { describe, expect, it } from 'vitest'
import { calculateCanvasTransform } from '../game/canvasTransform.js'

const VIEW_WIDTH = 920
const VIEW_HEIGHT = 360
const GROUND = 285
const DINO_X = 96

function transformFor(canvasWidth, canvasHeight, fullscreen = true) {
  return calculateCanvasTransform({
    canvasWidth,
    canvasHeight,
    viewWidth: VIEW_WIDTH,
    viewHeight: VIEW_HEIGHT,
    ground: GROUND,
    fullscreen,
    dinoX: DINO_X,
  })
}

describe('canvas transform', () => {
  it('keeps non-fullscreen canvas proportional', () => {
    const transform = transformFor(1000, 500, false)

    expect(transform.scale).toBeCloseTo(1000 / VIEW_WIDTH)
    expect(transform.offsetX).toBeCloseTo(0)
    expect(transform.offsetY).toBeGreaterThan(0)
  })

  it('uses contain scaling in landscape fullscreen so the full track is visible', () => {
    const transform = transformFor(1688, 780)

    expect(transform.scale).toBeCloseTo(1688 / VIEW_WIDTH)
    expect(transform.offsetX).toBeCloseTo(0)
    expect(transform.offsetY).toBeGreaterThan(0)
  })

  it('keeps portrait fullscreen vertically within the screen', () => {
    const portrait = transformFor(780, 1688)

    expect(portrait.offsetY).toBeGreaterThan(0)
    expect(portrait.offsetY + VIEW_HEIGHT * portrait.scale).toBeLessThanOrEqual(1688)
  })
})
