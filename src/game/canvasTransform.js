const FULLSCREEN_DINO_X_RATIO = 0.18
const FULLSCREEN_GROUND_Y_RATIO = 0.82
const PORTRAIT_GROUND_Y_RATIO = 0.6

export function calculateCanvasTransform({
  canvasWidth,
  canvasHeight,
  viewWidth,
  viewHeight,
  ground,
  fullscreen,
  dinoX,
}) {
  if (!fullscreen) {
    const scale = Math.min(canvasWidth / viewWidth, canvasHeight / viewHeight)
    return {
      scale,
      offsetX: (canvasWidth - viewWidth * scale) / 2,
      offsetY: (canvasHeight - viewHeight * scale) / 2,
    }
  }

  if (canvasHeight > canvasWidth) {
    const visibleWidth = landscapeVisibleWidth(canvasWidth, canvasHeight, viewWidth, viewHeight)
    const scale = canvasWidth / visibleWidth
    const minX = Math.min(0, canvasWidth - viewWidth * scale)
    const maxY = Math.max(0, canvasHeight - viewHeight * scale)
    const targetGroundY = canvasHeight * PORTRAIT_GROUND_Y_RATIO

    return {
      scale,
      offsetX: clamp(canvasWidth * FULLSCREEN_DINO_X_RATIO - dinoX * scale, minX, 0),
      offsetY: clamp(targetGroundY - ground * scale, 0, maxY),
    }
  }

  const scale = Math.max(canvasWidth / viewWidth, canvasHeight / viewHeight)
  const minX = Math.min(0, canvasWidth - viewWidth * scale)
  const minY = Math.min(0, canvasHeight - viewHeight * scale)
  const targetDinoX = canvasWidth * FULLSCREEN_DINO_X_RATIO
  const targetGroundY = canvasHeight * FULLSCREEN_GROUND_Y_RATIO

  return {
    scale,
    offsetX: clamp(targetDinoX - dinoX * scale, minX, 0),
    offsetY: clamp(targetGroundY - ground * scale, minY, 0),
  }
}

function landscapeVisibleWidth(canvasWidth, canvasHeight, viewWidth, viewHeight) {
  const landscapeWidth = Math.max(canvasWidth, canvasHeight)
  const landscapeHeight = Math.min(canvasWidth, canvasHeight)
  const landscapeScale = Math.max(landscapeWidth / viewWidth, landscapeHeight / viewHeight)
  return landscapeWidth / landscapeScale
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
