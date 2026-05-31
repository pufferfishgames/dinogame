import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

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
})
