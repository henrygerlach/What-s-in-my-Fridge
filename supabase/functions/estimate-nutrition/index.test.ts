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

const valid = {
  title: 'Pfannkuchen',
  portions: 2,
  ingredients: [{ name: 'Mehl', quantity: 200, unit: 'g' }],
}

describe('estimate-nutrition', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
  })

  it('requires a title, a portion count and an ingredients array', async () => {
    expect((await fn.post({ ...valid, title: '' })).status).toBe(400)
    expect((await fn.post({ ...valid, portions: 0 })).status).toBe(400)
    expect((await fn.post({ ...valid, ingredients: 'Mehl' })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('accepts an empty ingredient list', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"kcal":0,"protein_g":0,"fat_g":0,"carbs_g":0}'))
    expect((await fn.post({ ...valid, ingredients: [] })).status).toBe(200)
  })

  it('lists ingredients with quantity and unit in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    await fn.post(valid)
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(prompt).toContain('Pfannkuchen')
    expect(prompt).toContain('ergibt 2 Portionen')
    expect(prompt).toContain('- Mehl (200 g)')
  })

  it('omits an absent quantity and a unit-less quantity cleanly', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    await fn.post({
      ...valid,
      ingredients: [
        { name: 'Salz', quantity: null, unit: null },
        { name: 'Eier', quantity: 3, unit: null },
      ],
    })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(prompt).toContain('- Salz\n')
    expect(prompt).toContain('- Eier (3)')
  })

  it('returns the four per-portion values', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"kcal":520,"protein_g":18.5,"fat_g":12,"carbs_g":80}'))
    expect(await (await fn.post(valid)).json()).toEqual({ kcal: 520, protein_g: 18.5, fat_g: 12, carbs_g: 80 })
  })

  // The model is told "no strings, no units" but sometimes sends "520 kcal"
  // anyway; storing that would poison every later sum.
  it('nulls out values that are not finite numbers', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('{"kcal":"520 kcal","protein_g":null,"fat_g":12,"carbs_g":"viele"}'),
    )
    expect(await (await fn.post(valid)).json()).toEqual({ kcal: null, protein_g: null, fat_g: 12, carbs_g: null })
  })

  it('returns all-null when the reply has no values at all', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    expect(await (await fn.post(valid)).json()).toEqual({ kcal: null, protein_g: null, fat_g: null, carbs_g: null })
  })

  it('returns 502 when the model call fails and 500 on unparseable output', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure())
    expect((await fn.post(valid)).status).toBe(502)

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
    expect((await fn.post(valid)).status).toBe(500)
  })
})
