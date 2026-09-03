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

const inventory = [
  { name: 'Bohnen', quantity: 2, unit: 'Dose' },
  { name: 'Reis', quantity: null, unit: null },
]

const suggestion = JSON.stringify([
  {
    title: 'Chili sin Carne',
    category: 'Große Mahlzeit',
    portions: 4,
    description: 'Herzhaft',
    instructions: '1. Anbraten.',
    ingredients: [{ name: 'Bohnen', quantity: 1, unit: 'Dose' }],
  },
])

describe('suggest-recipes', () => {
  it('answers a CORS preflight', async () => {
    expect((await fn.options()).status).toBe(200)
  })

  it('requires an inventory array and a prompt', async () => {
    expect((await fn.post({ prompt: 'schnell' })).status).toBe(400)
    expect((await fn.post({ inventory, prompt: '' })).status).toBe(400)
    expect((await fn.post({ inventory: 'alles', prompt: 'schnell' })).status).toBe(400)
    expect(fn.fetchMock).not.toHaveBeenCalled()
  })

  it('accepts an empty inventory and says so in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    const response = await fn.post({ inventory: [], prompt: 'irgendwas' })
    expect(response.status).toBe(200)
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).toContain('kein Inventar hinterlegt')
  })

  it('lists the stock with amounts, and the user’s request, in the prompt', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ inventory, prompt: 'etwas mit Bohnen' })
    const prompt = anthropicRequestBody(fn.fetchMock).messages[0].content
    expect(prompt).toContain('Bohnen (2Dose vorhanden)')
    expect(prompt).toContain('Reis')
    expect(prompt).toContain('etwas mit Bohnen')
  })

  it('returns normalized suggestions', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply(suggestion))
    expect(await (await fn.post({ inventory, prompt: 'schnell' })).json()).toEqual({
      suggestions: [
        {
          title: 'Chili sin Carne',
          category: 'Große Mahlzeit',
          portions: 4,
          description: 'Herzhaft',
          instructions: '1. Anbraten.',
          ingredients: [{ name: 'Bohnen', quantity: 1, unit: 'Dose' }],
        },
      ],
    })
  })

  it('nulls an unknown category and a non-positive portion count', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('[{"title":"X","category":"Dessert","portions":0,"ingredients":[]}]'),
    )
    const { suggestions } = await (await fn.post({ inventory, prompt: 'x' })).json()
    expect(suggestions[0]).toMatchObject({ category: null, portions: null })
  })

  it('defaults a missing description, instructions and ingredient list', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"title":"X"}]'))
    const { suggestions } = await (await fn.post({ inventory, prompt: 'x' })).json()
    expect(suggestions[0]).toMatchObject({ description: '', instructions: '', ingredients: [] })
  })

  // A suggestion saved straight into the recipe table would otherwise carry
  // a unit that stock matching cannot use.
  it('rejects ingredient units outside the app vocabulary', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('[{"title":"X","ingredients":[{"name":"Öl","quantity":2,"unit":"EL"}]}]'),
    )
    const { suggestions } = await (await fn.post({ inventory, prompt: 'x' })).json()
    expect(suggestions[0].ingredients[0]).toEqual({ name: 'Öl', quantity: 2, unit: null })
  })

  it('rejects a non-numeric ingredient quantity', async () => {
    fn.fetchMock.mockResolvedValue(
      stubAnthropicReply('[{"title":"X","ingredients":[{"name":"Öl","quantity":"etwas","unit":"ml"}]}]'),
    )
    const { suggestions } = await (await fn.post({ inventory, prompt: 'x' })).json()
    expect(suggestions[0].ingredients[0].quantity).toBeNull()
  })

  it('tells the model to prefer recipes the current amounts actually cover', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
    await fn.post({ inventory, prompt: 'x' })
    expect(anthropicRequestBody(fn.fetchMock).messages[0].content).toContain('vorhandenen Mengen tatsächlich ausreichen')
  })

  it('returns no suggestions for an empty reply', async () => {
    fn.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [] }), text: async () => '' })
    expect(await (await fn.post({ inventory, prompt: 'x' })).json()).toEqual({ suggestions: [] })
  })

  it('returns 502 when the model call fails and 500 on unparseable output', async () => {
    fn.fetchMock.mockResolvedValue(stubAnthropicFailure(503, 'overloaded'))
    expect((await fn.post({ inventory, prompt: 'x' })).status).toBe(502)

    fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
    expect((await fn.post({ inventory, prompt: 'x' })).status).toBe(500)
  })
})
