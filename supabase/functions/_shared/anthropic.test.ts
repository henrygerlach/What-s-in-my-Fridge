import { describe, it, expect } from 'vitest'
import { extractText } from './anthropic.ts'

describe('extractText', () => {
  it('returns the text of the text block', () => {
    expect(extractText({ content: [{ type: 'text', text: 'hallo' }] })).toBe('hallo')
  })

  // The reply is not reliably at content[0]: a thinking block can precede it,
  // and indexing blindly would hand JSON.parse an undefined.
  it('skips a leading thinking block', () => {
    expect(
      extractText({
        content: [
          { type: 'thinking', text: undefined },
          { type: 'text', text: '{"a":1}' },
        ],
      }),
    ).toBe('{"a":1}')
  })

  it('returns an empty string when there is no text block', () => {
    expect(extractText({ content: [{ type: 'thinking' }] })).toBe('')
    expect(extractText({ content: [] })).toBe('')
    expect(extractText({})).toBe('')
  })

  it('returns an empty string for a text block with no text', () => {
    expect(extractText({ content: [{ type: 'text' }] })).toBe('')
  })

  it('takes the first text block when several are present', () => {
    expect(
      extractText({
        content: [
          { type: 'text', text: 'erste' },
          { type: 'text', text: 'zweite' },
        ],
      }),
    ).toBe('erste')
  })
})
