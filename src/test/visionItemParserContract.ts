import { describe, it, expect } from 'vitest'
import { stubAnthropicReply, stubAnthropicFailure, type EdgeFunctionHarness } from './denoHarness'

// parse-receipt and parse-fridge-photo differ only in their prompt: both take
// a base64 image and return a normalized item list. This is the behaviour
// they must share, asserted against each of them separately.
export function describeVisionItemParser(name: string, getHarness: () => EdgeFunctionHarness) {
  describe(`${name} — shared vision item contract`, () => {
    it('answers a CORS preflight without calling the model', async () => {
      const fn = getHarness()
      const response = await fn.options()
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(fn.fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a missing or non-string image with 400', async () => {
      const fn = getHarness()
      expect((await fn.post({})).status).toBe(400)
      expect((await fn.post({ image: '' })).status).toBe(400)
      expect((await fn.post({ image: 123 })).status).toBe(400)
      expect(fn.fetchMock).not.toHaveBeenCalled()
    })

    it('sends the image as a base64 JPEG block ahead of the prompt', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
      await fn.post({ image: 'QUJD' })

      const [, init] = fn.fetchMock.mock.calls[0] as [string, RequestInit]
      const content = JSON.parse(String(init.body)).messages[0].content
      expect(content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
      })
      expect(content[1].type).toBe('text')
    })

    it('keeps the API key server-side', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('[]'))
      await fn.post({ image: 'QUJD' })
      const [, init] = fn.fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key')
    })

    it('normalizes a well-formed item', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(
        stubAnthropicReply(
          '[{"name":"  Vollmilch ","quantity":1,"unit":"l","grams_per_unit":null,"category":"Milchprodukte & Eier","location":"fridge"}]',
        ),
      )
      expect(await (await fn.post({ image: 'x' })).json()).toEqual({
        items: [
          {
            name: 'Vollmilch',
            quantity: 1,
            unit: 'l',
            grams_per_unit: null,
            category: 'Milchprodukte & Eier',
            location: 'fridge',
          },
        ],
      })
    })

    it('drops items with no usable name', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"name":""},{"name":"   "},{"name":"Brot"}]'))
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items.map((item: { name: string }) => item.name)).toEqual(['Brot'])
    })

    // Everything below is a value the model can invent; each would corrupt
    // stock matching or grouping if written through unchecked.
    it('rejects a unit outside the app vocabulary', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"name":"Öl","unit":"EL","quantity":2}]'))
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items[0].unit).toBeNull()
    })

    it('rejects a non-numeric quantity', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('[{"name":"Brot","quantity":"zwei"}]'))
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items[0].quantity).toBeNull()
    })

    it('rejects a non-positive grams-per-unit estimate', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(
        stubAnthropicReply('[{"name":"Dose","unit":"Dose","grams_per_unit":0},{"name":"Glas","unit":"Glas","grams_per_unit":400}]'),
      )
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items[0].grams_per_unit).toBeNull()
      expect(items[1].grams_per_unit).toBe(400)
    })

    it('blanks an unknown category and defaults an unknown location to the fridge', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(
        stubAnthropicReply('[{"name":"Brot","category":"Weltraumnahrung","location":"garage"}]'),
      )
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items[0]).toMatchObject({ category: '', location: 'fridge' })
    })

    it('unwraps a markdown-fenced reply', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('```json\n[{"name":"Brot"}]\n```'))
      const { items } = await (await fn.post({ image: 'x' })).json()
      expect(items).toHaveLength(1)
    })

    it('returns an empty list for an empty reply', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ content: [] }),
        text: async () => '',
      })
      expect(await (await fn.post({ image: 'x' })).json()).toEqual({ items: [] })
    })

    it('returns 502 when the model call fails', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicFailure(429, 'rate limited'))
      const response = await fn.post({ image: 'x' })
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ error: 'LLM request failed', details: 'rate limited' })
    })

    it('returns 500 for an unparseable reply or request body', async () => {
      const fn = getHarness()
      fn.fetchMock.mockResolvedValue(stubAnthropicReply('kein JSON'))
      expect((await fn.post({ image: 'x' })).status).toBe(500)
      expect(
        (await fn.handler(new Request('https://edge.test/fn', { method: 'POST', body: 'nope' }))).status,
      ).toBe(500)
    })
  })
}
