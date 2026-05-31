const FULLSCREEN_DINO_X_RATIO = 0.18
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
  if (fullscreen && canvasHeight > canvasWidth) {
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

  // Non-fullscreen and landscape fullscreen both use contain scaling so the
  // full track width is always visible, centred within the canvas.
  const scale = Math.min(canvasWidth / viewWidth, canvasHeight / viewHeight)
  return {
    scale,
    offsetX: (canvasWidth - viewWidth * scale) / 2,
    offsetY: (canvasHeight - viewHeight * scale) / 2,
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
