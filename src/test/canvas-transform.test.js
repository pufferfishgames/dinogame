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

  it('uses cover scaling in landscape fullscreen', () => {
    const transform = transformFor(1688, 780)

    expect(transform.scale).toBeCloseTo(780 / VIEW_HEIGHT)
    expect(1688 / transform.scale).toBeCloseTo(779.08)
    expect(transform.offsetY).toBeLessThanOrEqual(0)
  })

  it('preserves landscape-equivalent road visibility in portrait fullscreen', () => {
    const portrait = transformFor(780, 1688)
    const landscape = transformFor(1688, 780)

    expect(780 / portrait.scale).toBeCloseTo(1688 / landscape.scale)
    expect(portrait.offsetY).toBeGreaterThan(0)
    expect(portrait.offsetY + VIEW_HEIGHT * portrait.scale).toBeLessThanOrEqual(1688)
  })
})
