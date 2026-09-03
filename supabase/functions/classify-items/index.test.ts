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

describe('classify-items', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing or empty names array with 400', async () => {
    expect((await fn.post({})).status).toBe(400)
    expect((await fn.post({ names: [] })).status).toBe(400)
    expect((await fn.post({ names: 'Cola' })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('classifies a whole batch in one call, index-numbered in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"category":"Getränke"},{"category":"Obst & Gemüse"}]'))
    const response = await fn.post({ names: ['Cola', 'Apfel'] })

    expect(fn.fetchMock).toHaveBeenCalledTimes(1)
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).toContain('0. Cola\n1. Apfel')
    expect(await response.json()).toEqual({ categories: ['Getränke', 'Obst & Gemüse'] })
  })

  it('caps the batch at fifty names', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    const names = Array.from({ length: 80 }, (_, i) => `Ware ${i}`)
    const { categories } = await (await fn.post({ names })).json()

    expect(categories).toHaveLength(50)
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).not.toContain('Ware 50')
  })

  it('coerces non-string entries rather than failing the batch', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"category":"Sonstiges"}]'))
    await fn.post({ names: [42] })
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).toContain('0. 42')
  })

  // The reply is index-matched to the request, so a short, long or ragged
  // array must not shift every later item into the wrong category.
  it('pads a short reply with empty categories', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"category":"Getränke"}]'))
    expect(await (await fn.post({ names: ['Cola', 'Apfel'] })).json()).toEqual({ categories: ['Getränke', ''] })
  })

  it('ignores extra entries in a long reply', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"category":"Getränke"},{"category":"Sonstiges"}]'))
    expect(await (await fn.post({ names: ['Cola'] })).json()).toEqual({ categories: ['Getränke'] })
  })

  it('drops categories outside the allowed set', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"category":"Weltraumnahrung"},{"category":null}]'))
    expect(await (await fn.post({ names: ['a', 'b'] })).json()).toEqual({ categories: ['', ''] })
  })

  it('unwraps a markdown-fenced reply', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('```json\n[{"category":"Getränke"}]\n```'))
    expect(await (await fn.post({ names: ['Cola'] })).json()).toEqual({ categories: ['Getränke'] })
  })

  it('treats an empty reply as no categories rather than crashing', async () => {
    fn.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }), text: async () => '' })
    expect(await (await fn.post({ names: ['Cola'] })).json()).toEqual({ categories: [''] })
  })

  it('returns 502 when the model call fails', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure(503, 'overloaded'))
    const response = await fn.post({ names: ['Cola'] })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ details: 'overloaded' })
  })

  it('returns 500 for an unparseable reply or body', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
    expect((await fn.post({ names: ['Cola'] })).status).toBe(500)
    expect((await fn.handler(new Request('https://edge.test/fn', { method: 'POST', body: '{' }))).status).toBe(500)
  })
})
