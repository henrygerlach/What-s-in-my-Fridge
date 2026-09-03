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

describe('guess-recipe-tags', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
  })

  it('rejects a missing or non-string title with 400', async () => {
    expect((await fn.post({})).status).toBe(400)
    expect((await fn.post({ title: '' })).status).toBe(400)
    expect((await fn.post({ title: 7 })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('names the recipe and lists each group’s cardinality in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":[]}'))
    await fn.post({ title: 'Chili sin Carne' })

    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(prompt).toContain('Chili sin Carne')
    expect(prompt).toContain('höchstens einer')
    expect(prompt).toContain('beliebig viele')
  })

  it('returns valid tags', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Vegan","20–40 Min.","Günstig"]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({
      tags: ['Vegan', '20–40 Min.', 'Günstig'],
    })
  })

  it('drops tags that are not in any group', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Vegan","Erfunden"]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: ['Vegan'] })
  })

  // The diet and duration groups are radio-like in the UI; two selections
  // would leave the tag picker in a state the user cannot reproduce.
  it('keeps only the first tag from a single-select group', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Vegan","Fleisch","< 10 Min.","> 40 Min."]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: ['Vegan', '< 10 Min.'] })
  })

  it('keeps every tag from a multi-select group', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Günstig","Meal Prep","Scharf"]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({
      tags: ['Günstig', 'Meal Prep', 'Scharf'],
    })
  })

  it('returns tags in group order regardless of the model’s order', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Scharf","< 10 Min.","Vegan"]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: ['Vegan', '< 10 Min.', 'Scharf'] })
  })

  it('ignores non-string entries in the tag array', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Vegan",42,null]}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: ['Vegan'] })
  })

  it('returns no tags when the reply has none or the wrong shape', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":"Vegan"}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: [] })

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    expect(await (await fn.post({ title: 'Chili' })).json()).toEqual({ tags: [] })
  })

  it('returns 502 when the model call fails and 500 on unparseable output', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure())
    expect((await fn.post({ title: 'Chili' })).status).toBe(502)

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
    expect((await fn.post({ title: 'Chili' })).status).toBe(500)
  })
})
