import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.svelte', import.meta.url), 'utf8')
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('product copy', () => {
  it('uses Nikolai branding instead of the old relay name', () => {
    expect(app).toContain("Nikolai's dino race")
    expect(index).toContain("Nikolai's dino race")
    expect(app).not.toContain('Dino Relay')
    expect(index).not.toContain('Dino Relay')
    expect(app).not.toContain('Nostr relay racer')
  })

  it('does not draw the brand name over the initial track', () => {
    expect(app).not.toContain("drawCenteredLabel('NIKOLAI'")
  })

  it('shows cumulative total language instead of best-score language', () => {
    expect(app).toContain('<span>Total</span>')
    expect(app).toContain('<h2>Total Scores</h2>')
    expect(app).not.toContain('<span>Best</span>')
    expect(app).not.toContain('<h2>High Scores</h2>')
  })

  it('starts with an empty editable player name', () => {
    expect(app).toContain("let playerName = ''")
    expect(app).not.toContain("let playerName = 'DINO'")
  })

  it('does not render a manual join button', () => {
    expect(app).not.toContain('>Join</button>')
  })
})
