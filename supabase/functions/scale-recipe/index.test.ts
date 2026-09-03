import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadEdgeFunction,
  stubAnthropicReply,
  stubAnthropicFailure,
  anthropicRequestBody,
  type EdgeFunctionHarness,
} from '../../../src/test/denoHarness'

let fn: EdgeFunctionHarness

beforeEach(async () => {
  fn = await loadEdgeFunction(() => import('./index.ts'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const valid = { instructions: '1. 2 Eier verquirlen.', originalPortions: 2, newPortions: 4 }

describe('scale-recipe', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
  })

  it('requires instructions and both portion counts', async () => {
    expect((await fn.post({ ...valid, instructions: '' })).status).toBe(400)
    expect((await fn.post({ ...valid, originalPortions: 0 })).status).toBe(400)
    expect((await fn.post({ ...valid, newPortions: 0 })).status).toBe(400)
    expect((await fn.post({})).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('states both portion counts and the computed factor in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('1. 4 Eier verquirlen.'))
    await fn.post(valid)

    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(prompt).toContain('für 2 Portionen')
    expect(prompt).toContain('für 4 Portionen')
    expect(prompt).toContain('Faktor 2.000')
    expect(prompt).toContain('1. 2 Eier verquirlen.')
  })

  it('computes a fractional factor to three decimals', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('text'))
    await fn.post({ ...valid, originalPortions: 3, newPortions: 1 })
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).toContain('Faktor 0.333')
  })

  it('returns the rewritten instructions, trimmed', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('  1. 4 Eier verquirlen.  '))
    expect(await (await fn.post(valid)).json()).toEqual({ instructions: '1. 4 Eier verquirlen.' })
  })

  // Returning the original text beats returning an empty recipe: the user
  // sees unscaled steps rather than a blank screen.
  it('falls back to the original text when the model returns nothing', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('   '))
    expect(await (await fn.post(valid)).json()).toEqual({ instructions: '1. 2 Eier verquirlen.' })

    fn.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }), text: async () => '' })
    expect(await (await fn.post(valid)).json()).toEqual({ instructions: '1. 2 Eier verquirlen.' })
  })

  it('returns 502 when the model call fails', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure(500, 'nope'))
    expect((await fn.post(valid)).status).toBe(502)
  })

  it('returns 500 when the request body is not JSON', async () => {
    expect((await fn.handler(new Request('https://edge.test/fn', { method: 'POST', body: 'x' }))).status).toBe(500)
  })
})
