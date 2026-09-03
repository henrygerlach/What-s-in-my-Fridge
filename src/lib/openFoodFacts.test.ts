import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchProductByBarcode } from './openFoodFacts'

function mockFetch(response: { ok?: boolean; body?: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok ?? true,
    json: async () => response.body,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchProductByBarcode', () => {
  it('queries the Open Food Facts v2 product endpoint', async () => {
    const fetchMock = mockFetch({ body: { status: 1, product: { product_name: 'Cola', quantity: '1 l' } } })
    await fetchProductByBarcode('4001234567890')
    expect(fetchMock).toHaveBeenCalledWith('https://world.openfoodfacts.org/api/v2/product/4001234567890.json')
  })

  it('returns null on a non-OK response', async () => {
    mockFetch({ ok: false })
    expect(await fetchProductByBarcode('123')).toBeNull()
  })

  it('returns null when the product is unknown', async () => {
    mockFetch({ body: { status: 0 } })
    expect(await fetchProductByBarcode('123')).toBeNull()
  })

  it('returns null when the payload has no product', async () => {
    mockFetch({ body: { status: 1, product: null } })
    expect(await fetchProductByBarcode('123')).toBeNull()
  })

  it('maps name, first category and parsed quantity', async () => {
    mockFetch({
      body: {
        status: 1,
        product: { product_name: 'Tomaten', categories: 'Gemüse, Konserven', quantity: '400 g' },
      },
    })
    expect(await fetchProductByBarcode('123')).toEqual({
      name: 'Tomaten',
      category: 'Gemüse',
      quantity: 400,
      unit: 'g',
    })
  })

  it('falls back to the generic name', async () => {
    mockFetch({ body: { status: 1, product: { generic_name: 'Limonade' } } })
    expect((await fetchProductByBarcode('123'))?.name).toBe('Limonade')
  })

  it('returns empty strings when neither name nor category is present', async () => {
    mockFetch({ body: { status: 1, product: {} } })
    expect(await fetchProductByBarcode('123')).toEqual({ name: '', category: '', quantity: null, unit: null })
  })

  it('normalizes unit aliases to the app’s unit vocabulary', async () => {
    for (const [raw, expected] of [
      ['500 gr', 'g'],
      ['1 Kilogramm', 'kg'],
      ['750 Milliliter', 'ml'],
      ['2 Liter', 'l'],
      ['6 Stk', 'Stück'],
      ['4 pieces', 'Stück'],
    ] as const) {
      mockFetch({ body: { status: 1, product: { quantity: raw } } })
      expect((await fetchProductByBarcode('123'))?.unit).toBe(expected)
    }
  })

  it('accepts a comma decimal in the quantity', async () => {
    mockFetch({ body: { status: 1, product: { quantity: '1,5 l' } } })
    expect(await fetchProductByBarcode('123')).toMatchObject({ quantity: 1.5, unit: 'l' })
  })

  it('yields a null unit for an unrecognised one, keeping the number', async () => {
    mockFetch({ body: { status: 1, product: { quantity: '12 Fantasieeinheit' } } })
    expect(await fetchProductByBarcode('123')).toMatchObject({ quantity: 12, unit: null })
  })

  it('yields no quantity when the field is missing or unparseable', async () => {
    mockFetch({ body: { status: 1, product: {} } })
    expect(await fetchProductByBarcode('123')).toMatchObject({ quantity: null, unit: null })

    mockFetch({ body: { status: 1, product: { quantity: 'family pack' } } })
    expect(await fetchProductByBarcode('123')).toMatchObject({ quantity: null, unit: null })
  })
})
