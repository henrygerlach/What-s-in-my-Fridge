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

describeVisionItemParser('parse-receipt', () => fn)

describe('parse-receipt prompt', () => {
  it('frames the image as a supermarket receipt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('Kassenbon')
  })

  // Deposit lines, discounts and bags are the bulk of a German receipt and
  // none of them belong in a food inventory.
  it('tells the model to ignore deposits, discounts and non-food lines', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('Pfand')
    expect(prompt).toContain('Rabatte')
  })

  it('asks for generic names rather than the receipt’s own wording', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content[1].text).toContain('ohne Markennamen')
  })

  it('includes the unit and grams-per-unit instructions', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('grams_per_unit')
    expect(prompt).toContain('15 ml')
  })
})
