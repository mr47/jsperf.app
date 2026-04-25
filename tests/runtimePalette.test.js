import { describe, expect, it } from 'vitest'
import { runtimeHexColor, runtimePalette, runtimePaletteKey } from '../lib/runtimePalette'

describe('runtimePalette', () => {
  it('keeps Node variants visually distinct from plain Node', () => {
    expect(runtimePaletteKey('node@25.0')).toBe('node')
    expect(runtimePaletteKey('node-gil')).toBe('node-gil')
    expect(runtimeHexColor('node-gil')).not.toBe(runtimeHexColor('node'))
  })

  it('keeps versioned runtime ids on their base palette', () => {
    expect(runtimePalette('deno@2.7.19').label).toBe('Deno')
    expect(runtimePalette('bun@1.3.13').hex).toBe(runtimeHexColor('bun'))
  })
})
