import { UNIT_OPTIONS } from './constants'

export interface OpenFoodFactsProduct {
  name: string
  category: string
  quantity: number | null
  unit: string | null
}

const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gr: 'g',
  gram: 'g',
  gramm: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilogramm: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  l: 'l',
  liter: 'l',
  stk: 'Stück',
  stück: 'Stück',
  stueck: 'Stück',
  piece: 'Stück',
  pieces: 'Stück',
}

for (const option of UNIT_OPTIONS) {
  UNIT_ALIASES[option.toLowerCase()] = option
}

function parseQuantity(raw: string | undefined): { quantity: number | null; unit: string | null } {
  if (!raw) return { quantity: null, unit: null }
  const match = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zäöüß]+)/)
  if (!match) return { quantity: null, unit: null }

  const quantity = Number(match[1].replace(',', '.'))
  const unit = UNIT_ALIASES[match[2].toLowerCase()] ?? null
  return { quantity: Number.isFinite(quantity) ? quantity : null, unit }
}

export async function fetchProductByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`)
  if (!response.ok) return null

  const data = await response.json()
  if (data.status !== 1 || !data.product) return null

  const product = data.product
  const { quantity, unit } = parseQuantity(product.quantity)

  return {
    name: product.product_name || product.generic_name || '',
    category: (product.categories || '').split(',')[0]?.trim() || '',
    quantity,
    unit,
  }
}
