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

describe('classify-item', () => {
  it('answers a CORS preflight without calling the model', async () => {
    const response = await fn.options()
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing or non-string name with 400', async () => {
    expect((await fn.post({})).status).toBe(400)
    expect((await fn.post({ name: '' })).status).toBe(400)
    expect((await fn.post({ name: 42 })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('sends the item name and the allowed values in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke","location":"pantry"}'))
    await fn.post({ name: 'Cola' })

    const body = anthropicRequestBody(fn.fetchMock)
    expect(body.messages[0].content).toContain('Cola')
    expect(body.messages[0].content).toContain('Getränke')
    expect(body.messages[0].content).toContain('"fridge"')
  })

  it('passes the API key from the environment, never from the request', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke","location":"pantry"}'))
    await fn.post({ name: 'Cola' })

    const [url, init] = fn.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key')
  })

  it('returns the classification', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke","location":"pantry"}'))
    const response = await fn.post({ name: 'Cola' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ category: 'Getränke', location: 'pantry' })
  })

  it('unwraps a markdown-fenced reply', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('```json\n{"category":"Getränke","location":"pantry"}\n```'),
    )
    expect(await (await fn.post({ name: 'Cola' })).json()).toEqual({ category: 'Getränke', location: 'pantry' })
  })

  it('finds the text block even behind a thinking block', async () => {
    fn.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: '{"category":"Getränke","location":"pantry"}' },
        ],
      }),
      text: async () => '',
    })
    expect(await (await fn.post({ name: 'Cola' })).json()).toEqual({ category: 'Getränke', location: 'pantry' })
  })

  // A hallucinated category would be written straight into the database, so
  // anything outside the allowed set is dropped rather than trusted.
  it('drops a category outside the allowed set', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Weltraumnahrung","location":"pantry"}'))
    expect(await (await fn.post({ name: 'Cola' })).json()).toEqual({ category: '', location: 'pantry' })
  })

  it('falls back to the fridge for an invalid or missing location', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke","location":"garage"}'))
    expect(await (await fn.post({ name: 'Cola' })).json()).toMatchObject({ location: 'fridge' })

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke"}'))
    expect(await (await fn.post({ name: 'Cola' })).json()).toMatchObject({ location: 'fridge' })
  })

  it('returns 502 with the upstream detail when the model call fails', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure(429, 'rate limited'))
    const response = await fn.post({ name: 'Cola' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'LLM request failed', details: 'rate limited' })
  })

  it('returns 500 when the reply is not valid JSON', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('nicht mal ansatzweise JSON'))
    expect((await fn.post({ name: 'Cola' })).status).toBe(500)
  })

  it('returns 500 when the request body is not JSON', async () => {
    const response = await fn.handler(new Request('https://edge.test/fn', { method: 'POST', body: 'not json' }))
    expect(response.status).toBe(500)
  })

  it('treats an empty content array as an empty object rather than crashing', async () => {
    fn.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }), text: async () => '' })
    expect(await (await fn.post({ name: 'Cola' })).json()).toEqual({ category: '', location: 'fridge' })
  })

  it('sets CORS headers on every response', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Getränke","location":"pantry"}'))
    for (const response of [await fn.post({ name: 'Cola' }), await fn.post({}), await fn.options()]) {
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })
})
