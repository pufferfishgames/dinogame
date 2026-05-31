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
})
