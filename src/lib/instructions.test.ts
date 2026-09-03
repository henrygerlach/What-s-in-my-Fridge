import { describe, it, expect } from 'vitest'
import { splitInstructionSteps } from './instructions'

describe('splitInstructionSteps', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(splitInstructionSteps('')).toEqual([])
    expect(splitInstructionSteps('   \n  ')).toEqual([])
  })

  it('splits on real line breaks and drops blank lines', () => {
    expect(splitInstructionSteps('Zwiebeln schneiden\n\nAnbraten\nWürzen')).toEqual([
      'Zwiebeln schneiden',
      'Anbraten',
      'Würzen',
    ])
  })

  it('handles Windows line endings', () => {
    expect(splitInstructionSteps('Schritt eins\r\nSchritt zwei')).toEqual(['Schritt eins', 'Schritt zwei'])
  })

  // The model returns numbered steps as one unbroken paragraph often enough
  // that rendering it as a single blob would be the common case, not the edge.
  it('falls back to splitting before each numbered step', () => {
    expect(splitInstructionSteps('1. Wasser kochen 2. Nudeln zugeben 3. Abgießen')).toEqual([
      '1. Wasser kochen',
      '2. Nudeln zugeben',
      '3. Abgießen',
    ])
  })

  it('keeps unnumbered single-line prose as one step', () => {
    expect(splitInstructionSteps('Alles zusammen in den Topf geben.')).toEqual(['Alles zusammen in den Topf geben.'])
  })

  it('prefers real newlines over number splitting when both are present', () => {
    expect(splitInstructionSteps('1. Kochen\n2. Servieren')).toEqual(['1. Kochen', '2. Servieren'])
  })
})
