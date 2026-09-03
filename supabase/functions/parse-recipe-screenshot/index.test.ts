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

const fullRecipe = JSON.stringify({
  title: 'Chili sin Carne',
  category: 'Große Mahlzeit',
  portions: 4,
  instructions: '1. Zwiebeln anbraten.',
  ingredients: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400 }],
  tags: ['Vegan', '20–40 Min.', 'Scharf'],
})

describe('parse-recipe-screenshot', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing image with 400', async () => {
    expect((await fn.post({})).status).toBe(400)
    expect((await fn.post({ image: '' })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('sends the screenshot as a base64 JPEG block', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    await fn.post({ image: 'QUJD' })
    const content = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(content[0].source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'QUJD' })
  })

  it('returns a fully normalized recipe', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply(fullRecipe))
    expect(await (await fn.post({ image: 'x' })).json()).toEqual({
      recipe: {
        title: 'Chili sin Carne',
        category: 'Große Mahlzeit',
        portions: 4,
        instructions: '1. Zwiebeln anbraten.',
        ingredients: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400 }],
        tags: ['Vegan', '20–40 Min.', 'Scharf'],
      },
    })
  })

  it('falls back to empty strings for a missing title and instructions', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    const { recipe } = await (await fn.post({ image: 'x' })).json()
    expect(recipe).toMatchObject({ title: '', instructions: '', ingredients: [], tags: [] })
  })

  // Four portions is the app's own default; a screenshot rarely states one,
  // and a null would leave the recipe form unable to scale anything.
  it('defaults to four portions when none is usable', async () => {
    for (const portions of ['null', '0', '-2', '"vier"']) {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply(`{"portions":${portions}}`))
      const { recipe } = await (await fn.post({ image: 'x' })).json()
      expect(recipe.portions).toBe(4)
    }
  })

  it('keeps a positive portion count', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"portions":6}'))
    const { recipe } = await (await fn.post({ image: 'x' })).json()
    expect(recipe.portions).toBe(6)
  })

  it('nulls a category outside the three options', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"category":"Dessert"}'))
    const { recipe } = await (await fn.post({ image: 'x' })).json()
    expect(recipe.category).toBeNull()
  })

  it('accepts each of the three recipe categories', async () => {
    for (const category of ['Frühstück', 'Große Mahlzeit', 'Snack']) {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply(JSON.stringify({ category })))
      const { recipe } = await (await fn.post({ image: 'x' })).json()
      expect(recipe.category).toBe(category)
    }
  })

  it('normalizes ingredient units and grams-per-unit', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('{"ingredients":[{"name":"Öl","quantity":"zwei","unit":"EL","grams_per_unit":-1}]}'),
    )
    const { recipe } = await (await fn.post({ image: 'x' })).json()
    expect(recipe.ingredients[0]).toEqual({ name: 'Öl', quantity: null, unit: null, grams_per_unit: null })
  })

  describe('tag normalization', () => {
    it('drops unknown tags', async () => {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Vegan","Erfunden"]}'))
      const { recipe } = await (await fn.post({ image: 'x' })).json()
      expect(recipe.tags).toEqual(['Vegan'])
    })

    it('keeps only one tag from each single-select group', async () => {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Fisch","Vegan","< 10 Min.","> 40 Min."]}'))
      const { recipe } = await (await fn.post({ image: 'x' })).json()
      expect(recipe.tags).toEqual(['Fisch', '< 10 Min.'])
    })

    // Groups are emitted in group order; within the multi-select group the
    // model's own ordering is preserved.
    it('emits groups in order, keeping the model’s order inside the multi group', async () => {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":["Scharf","Günstig","Vegan"]}'))
      const { recipe } = await (await fn.post({ image: 'x' })).json()
      expect(recipe.tags).toEqual(['Vegan', 'Scharf', 'Günstig'])
    })

    it('ignores a non-array or non-string tags value', async () => {
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":"Vegan"}'))
      expect((await (await fn.post({ image: 'x' })).json()).recipe.tags).toEqual([])

      fn.fetchMock.mockResolvedValue(stubAnthropicReply('{"tags":[1,null,"Vegan"]}'))
      expect((await (await fn.post({ image: 'x' })).json()).recipe.tags).toEqual(['Vegan'])
    })
  })

  it('lists every tag group and its cardinality in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('{}'))
    await fn.post({ image: 'x' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content[1].text
    expect(prompt).toContain('Art')
    expect(prompt).toContain('Zubereitungszeit')
    expect(prompt).toContain('Eigenschaften')
    expect(prompt).toContain('maximal einer')
    expect(prompt).toContain('mehrere möglich')
  })

  it('returns 502 when the model call fails and 500 on unparseable output', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure())
    expect((await fn.post({ image: 'x' })).status).toBe(502)

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
    expect((await fn.post({ image: 'x' })).status).toBe(500)
  })

  it('returns an empty recipe rather than crashing on an empty reply', async () => {
    fn.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }), text: async () => '' })
    const { recipe } = await (await fn.post({ image: 'x' })).json()
    expect(recipe).toMatchObject({ title: '', portions: 4 })
  })
})
