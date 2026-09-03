import { describe, it, expect } from 'vitest'
import { toComparableQuantity, isIngredientAvailable, getMissingIngredients, computeStockDeductions } from './stock'

describe('toComparableQuantity', () => {
  it('converts within the weight and volume scales', () => {
    expect(toComparableQuantity(1, 'kg', 'g')).toBe(1000)
    expect(toComparableQuantity(500, 'g', 'kg')).toBe(0.5)
    expect(toComparableQuantity(1, 'l', 'ml')).toBe(1000)
  })

  it('passes a quantity through unchanged when the units already agree', () => {
    expect(toComparableQuantity(3, 'Dose', 'Dose')).toBe(3)
    expect(toComparableQuantity(2, null, null)).toBe(2)
  })

  // The point of the grams pivot: a tin is only comparable to a weight once
  // this particular item records what one tin of it weighs.
  it('pivots container units through grams when a factor is recorded', () => {
    expect(toComparableQuantity(1, 'Dose', 'g', 400)).toBe(400)
    expect(toComparableQuantity(800, 'g', 'Dose', null, 400)).toBe(2)
    expect(toComparableQuantity(1, 'Dose', 'Packung', 400, 200)).toBe(2)
  })

  it('returns null rather than guessing when the weight is unknowable', () => {
    expect(toComparableQuantity(1, 'Dose', 'g')).toBeNull()
    expect(toComparableQuantity(2, 'Stück', 'g')).toBeNull()
    expect(toComparableQuantity(1, 'kg', 'Dose')).toBeNull()
  })

  it('does not convert between weight and volume', () => {
    expect(toComparableQuantity(1, 'l', 'g')).toBeNull()
  })
})

describe('isIngredientAvailable', () => {
  it('is false when nothing in stock matches the name', () => {
    expect(isIngredientAvailable({ name: 'Reis', quantity: 200, unit: 'g' }, [])).toBe(false)
    expect(
      isIngredientAvailable({ name: 'Kokosmilch', quantity: 400, unit: 'ml' }, [
        { name: 'Milch', quantity: 1, unit: 'l' },
      ]),
    ).toBe(false)
  })

  it('compares quantities once both sides can be expressed in the same unit', () => {
    const stock = [{ name: 'Mehl', quantity: 1, unit: 'kg' }]
    expect(isIngredientAvailable({ name: 'Mehl', quantity: 500, unit: 'g' }, stock)).toBe(true)
    expect(isIngredientAvailable({ name: 'Mehl', quantity: 1500, unit: 'g' }, stock)).toBe(false)
  })

  it('covers a weight from a container unit via grams-per-unit', () => {
    const stock = [{ name: 'Tomaten', quantity: 1, unit: 'Dose', grams_per_unit: 400 }]
    expect(isIngredientAvailable({ name: 'Tomaten', quantity: 400, unit: 'g' }, stock)).toBe(true)
    expect(isIngredientAvailable({ name: 'Tomaten', quantity: 800, unit: 'g' }, stock)).toBe(false)
  })

  it('sums several matching stock rows toward one ingredient', () => {
    const stock = [
      { name: 'Tomaten', quantity: 1, unit: 'Dose', grams_per_unit: 400 },
      { name: 'Tomaten', quantity: 500, unit: 'g' },
    ]
    expect(isIngredientAvailable({ name: 'Tomaten', quantity: 800, unit: 'g' }, stock)).toBe(true)
  })

  // Falling back to presence is deliberate: an unknown amount of the right
  // thing beats telling the cook they cannot make the recipe.
  it('falls back to a presence check when quantities cannot be compared', () => {
    expect(
      isIngredientAvailable({ name: 'Zwiebel', quantity: 2, unit: 'Stück' }, [
        { name: 'Zwiebel', quantity: 1, unit: 'kg' },
      ]),
    ).toBe(true)
    expect(
      isIngredientAvailable({ name: 'Salz', quantity: 5, unit: 'g' }, [
        { name: 'Salz', quantity: null, unit: null },
      ]),
    ).toBe(true)
  })

  it('treats an ingredient with no quantity as satisfied by presence alone', () => {
    expect(
      isIngredientAvailable({ name: 'Pfeffer', quantity: null, unit: null }, [
        { name: 'Pfeffer', quantity: 1, unit: 'Packung' },
      ]),
    ).toBe(true)
  })
})

describe('getMissingIngredients', () => {
  it('returns only the ingredients that are not covered', () => {
    const missing = getMissingIngredients(
      [
        { name: 'Mehl', quantity: 200, unit: 'g' },
        { name: 'Hefe', quantity: 1, unit: 'Packung' },
      ],
      [{ name: 'Mehl', quantity: 1, unit: 'kg' }],
    )
    expect(missing.map((ingredient) => ingredient.name)).toEqual(['Hefe'])
  })
})

describe('computeStockDeductions', () => {
  it('deducts a cooked amount, converting into the stock row unit', () => {
    expect(
      computeStockDeductions([{ name: 'Mehl', quantity: 500, unit: 'g' }], [
        { id: 'a', name: 'Mehl', quantity: 1, unit: 'kg' },
      ]),
    ).toEqual([{ id: 'a', quantity: 0.5 }])
  })

  it('draws down several matching rows in order until the amount is covered', () => {
    expect(
      computeStockDeductions([{ name: 'Tomaten', quantity: 700, unit: 'g' }], [
        { id: 'a', name: 'Tomaten', quantity: 400, unit: 'g' },
        { id: 'b', name: 'Tomaten', quantity: 500, unit: 'g' },
      ]),
    ).toEqual([
      { id: 'a', quantity: 0 },
      { id: 'b', quantity: 200 },
    ])
  })

  it('leaves rows untouched when there is nothing well-defined to subtract', () => {
    expect(
      computeStockDeductions([{ name: 'Salz', quantity: null, unit: null }], [
        { id: 'a', name: 'Salz', quantity: 1, unit: 'Packung' },
      ]),
    ).toEqual([])
    expect(
      computeStockDeductions([{ name: 'Zwiebel', quantity: 2, unit: 'Stück' }], [
        { id: 'a', name: 'Zwiebel', quantity: 1, unit: 'kg' },
      ]),
    ).toEqual([])
  })

  it('never deducts from an unrelated compound-word item', () => {
    expect(
      computeStockDeductions([{ name: 'Kokosmilch', quantity: 400, unit: 'ml' }], [
        { id: 'a', name: 'Milch', quantity: 1, unit: 'l' },
      ]),
    ).toEqual([])
  })
})
