import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.svelte', import.meta.url), 'utf8')
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

function cssBlock(selector) {
  const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]+)\\}`, 's'))
  return match?.[1] ?? ''
}

describe('mobile layout css', () => {
  it('keeps the runner canvas proportional instead of stretching vertically', () => {
    const canvas = cssBlock('.runner-canvas')

    expect(canvas).toContain('aspect-ratio: 23 / 9')
    expect(canvas).toContain('height: auto')
    expect(canvas).not.toMatch(/height:\s*100%/)
    expect(canvas).not.toMatch(/min-height:\s*260px/)
  })

  it('does not force a viewport-height game row on mobile', () => {
    expect(css).not.toContain('minmax(260px, 54vh)')
  })

  it('keeps the total label readable on the green score box', () => {
    expect(cssBlock('.total-box span')).toContain('color: #f8f3e7')
  })

  it('locks mobile viewport scaling for fullscreen race controls', () => {
    expect(index).toContain('maximum-scale=1.0')
    expect(index).toContain('user-scalable=no')
    expect(index).toContain('viewport-fit=cover')
  })

  it('has an in-app fullscreen race mode that works in any orientation', () => {
    expect(app).toContain('requestFullscreen')
    expect(app).toContain('class:race-fullscreen')
    expect(css).toContain('.game-shell.race-fullscreen')
    expect(css).toContain('100dvh')
    expect(css).toContain('touch-action: none')
  })

  it('draws a birthday hat on the leading Chrome-style dinosaur', () => {
    expect(app).toContain('winningPubkey')
    expect(app).toContain('drawBirthdayHat')
    expect(app).toContain('drawChromeDinoShape')
  })
})
