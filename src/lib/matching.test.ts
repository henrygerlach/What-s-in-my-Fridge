import { describe, it, expect } from 'vitest'
import { isMatch } from './matching'

describe('isMatch', () => {
  it('matches identical names regardless of case and padding', () => {
    expect(isMatch('Tomate', 'tomate')).toBe(true)
    expect(isMatch('  Reis ', 'Reis')).toBe(true)
  })

  // The bug this whole function exists to prevent: German fuses compound
  // words, so a plain .includes() would report coconut milk as in stock
  // because there is ordinary milk in the fridge.
  it('does not match a word fused inside a compound word', () => {
    expect(isMatch('Kokosmilch', 'Milch')).toBe(false)
    expect(isMatch('Milch', 'Kokosmilch')).toBe(false)
    expect(isMatch('Erdnussbutter', 'Butter')).toBe(false)
  })

  it('matches on a word boundary inside a multi-word name', () => {
    expect(isMatch('Paprika', 'rote Paprika')).toBe(true)
    expect(isMatch('gemahlener Kreuzkümmel', 'Kreuzkümmel')).toBe(true)
  })

  it('matches across singular and plural forms', () => {
    expect(isMatch('Tomaten', 'Tomate')).toBe(true)
    expect(isMatch('Zwiebeln', 'Zwiebel')).toBe(true)
    expect(isMatch('Eier', 'Ei')).toBe(true)
  })

  it('rejects unrelated names', () => {
    expect(isMatch('Reis', 'Nudeln')).toBe(false)
  })

  it('never matches on an empty name', () => {
    expect(isMatch('', 'Milch')).toBe(false)
    expect(isMatch('Milch', '')).toBe(false)
  })
})
