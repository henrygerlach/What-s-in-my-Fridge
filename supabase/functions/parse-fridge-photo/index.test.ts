import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadEdgeFunction,
  stubAnthropicReply,
  anthropicRequestBody,
  type EdgeFunctionHarness,
} from '../../../src/test/denoHarness'
import { describeVisionItemParser } from '../../../src/test/visionItemParserContract'

let fn: EdgeFunctionHarness

beforeEach(async () => {
  fn = await loadEdgeFunction(() => import('./index.ts'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describeVisionItemParser('parse-fridge-photo', () => fn)

describe('parse-fridge-photo prompt', () => {
  it('frames the image as the inside of a fridge, freezer or pantry', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('Kühlschranks')
    expect(prompt).toContain('Vorratsschranks')
  })

  // Six identical yoghurts in shot must become one row with quantity 6, not
  // six duplicate inventory entries.
  it('asks for one row per item, using quantity for duplicates', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('nur einmal')
    expect(prompt).toContain('quantity')
  })

  it('tells the model to skip packaging and utensils', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content[1].text).toContain('Küchenutensilien')
  })
})
