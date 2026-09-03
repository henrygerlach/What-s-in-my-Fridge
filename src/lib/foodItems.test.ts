import { describe, it, expect, vi } from 'vitest'
import { saveFoodItem, revertSaveFoodItem } from './foodItems'
import { seed, rows, failOn } from '../test/fakeSupabase'

vi.mock('./supabase')

const base = {
  name: 'Tomaten',
  category: 'Obst & Gemüse',
  quantity: 400,
  unit: 'g',
  location: 'pantry' as const,
  source: 'manual' as const,
}

describe('saveFoodItem', () => {
  it('refuses a blank name without touching the database', async () => {
    const result = await saveFoodItem({ ...base, name: '   ' })
    expect(result).toEqual({ ok: false, id: null, merged: false, previousQuantity: null })
    expect(rows('food_items')).toHaveLength(0)
  })

  it('inserts a new row when nothing matches, and trims the name', async () => {
    const result = await saveFoodItem({ ...base, name: '  Tomaten  ' })
    expect(result).toMatchObject({ ok: true, merged: false, previousQuantity: null })
    expect(rows('food_items')).toHaveLength(1)
    expect(rows('food_items')[0]).toMatchObject({ name: 'Tomaten', quantity: 400, unit: 'g', location: 'pantry' })
  })

  it('writes an inventory log entry for a new row', async () => {
    await saveFoodItem(base)
    expect(rows('inventory_log')).toHaveLength(1)
    expect(rows('inventory_log')[0]).toMatchObject({ name: 'Tomaten', source: 'manual', location: 'pantry' })
  })

  it('merges into an existing row with the same name and unit', async () => {
    seed('food_items', [{ id: 'existing', name: 'Tomaten', unit: 'g', quantity: 100, location: 'pantry' }])
    const result = await saveFoodItem(base)
    expect(result).toEqual({ ok: true, id: 'existing', merged: true, previousQuantity: 100 })
    expect(rows('food_items')).toHaveLength(1)
    expect(rows('food_items')[0].quantity).toBe(500)
  })

  it('matches an existing name case-insensitively', async () => {
    seed('food_items', [{ id: 'existing', name: 'tomaten', unit: 'g', quantity: 100, location: 'pantry' }])
    const result = await saveFoodItem(base)
    expect(result.merged).toBe(true)
    expect(rows('food_items')).toHaveLength(1)
  })

  it('does not merge across storage locations', async () => {
    seed('food_items', [{ id: 'existing', name: 'Tomaten', unit: 'g', quantity: 100, location: 'fridge' }])
    const result = await saveFoodItem(base)
    expect(result.merged).toBe(false)
    expect(rows('food_items')).toHaveLength(2)
  })

  // The point of the convertible fallback: adding 250 g should top up an
  // existing "1 Packung" row rather than splitting the same food across two
  // rows in two units.
  it('merges into a convertible unit when no exact unit matches', async () => {
    seed('food_items', [
      { id: 'packung', name: 'Tomaten', unit: 'Packung', quantity: 1, grams_per_unit: 500, location: 'pantry' },
    ])
    const result = await saveFoodItem({ ...base, quantity: 250, unit: 'g' })
    expect(result).toMatchObject({ ok: true, id: 'packung', merged: true, previousQuantity: 1 })
    expect(rows('food_items')[0].quantity).toBe(1.5)
  })

  it('prefers an exact unit match over a convertible one', async () => {
    seed('food_items', [
      { id: 'packung', name: 'Tomaten', unit: 'Packung', quantity: 1, grams_per_unit: 500, location: 'pantry' },
      { id: 'grams', name: 'Tomaten', unit: 'g', quantity: 100, location: 'pantry' },
    ])
    const result = await saveFoodItem(base)
    expect(result.id).toBe('grams')
    expect(rows('food_items').find((row) => row.id === 'packung')?.quantity).toBe(1)
  })

  it('inserts a separate row when the units cannot be converted', async () => {
    seed('food_items', [{ id: 'stueck', name: 'Tomaten', unit: 'Stück', quantity: 3, location: 'pantry' }])
    const result = await saveFoodItem(base)
    expect(result.merged).toBe(false)
    expect(rows('food_items')).toHaveLength(2)
  })

  it('does not attempt a convertible merge when the new item has no quantity', async () => {
    seed('food_items', [
      { id: 'packung', name: 'Tomaten', unit: 'Packung', quantity: 1, grams_per_unit: 500, location: 'pantry' },
    ])
    const result = await saveFoodItem({ ...base, quantity: null })
    expect(result.merged).toBe(false)
    expect(rows('food_items')).toHaveLength(2)
  })

  it('treats a missing existing quantity as zero when merging', async () => {
    seed('food_items', [{ id: 'existing', name: 'Tomaten', unit: 'g', quantity: null, location: 'pantry' }])
    const result = await saveFoodItem(base)
    expect(result.previousQuantity).toBeNull()
    expect(rows('food_items')[0].quantity).toBe(400)
  })

  it('reports failure and logs nothing when the merge update fails', async () => {
    seed('food_items', [{ id: 'existing', name: 'Tomaten', unit: 'g', quantity: 100, location: 'pantry' }])
    failOn('food_items', 'update')
    const result = await saveFoodItem(base)
    expect(result.ok).toBe(false)
    expect(rows('inventory_log')).toHaveLength(0)
  })

  it('reports failure when the convertible merge update fails', async () => {
    seed('food_items', [
      { id: 'packung', name: 'Tomaten', unit: 'Packung', quantity: 1, grams_per_unit: 500, location: 'pantry' },
    ])
    failOn('food_items', 'update')
    const result = await saveFoodItem({ ...base, quantity: 250, unit: 'g' })
    expect(result.ok).toBe(false)
  })

  it('reports failure when the insert fails', async () => {
    failOn('food_items', 'insert')
    const result = await saveFoodItem(base)
    expect(result).toEqual({ ok: false, id: null, merged: false, previousQuantity: null })
    expect(rows('inventory_log')).toHaveLength(0)
  })

  it('stores an explicit null grams_per_unit when none is given', async () => {
    await saveFoodItem(base)
    expect(rows('food_items')[0].grams_per_unit).toBeNull()
  })

  it('logs a null category when the category is blank', async () => {
    await saveFoodItem({ ...base, category: '' })
    expect(rows('inventory_log')[0].category).toBeNull()
  })
})

describe('revertSaveFoodItem', () => {
  it('does nothing without an id', async () => {
    seed('food_items', [{ id: 'a', name: 'Tomaten', quantity: 1 }])
    await revertSaveFoodItem({ ok: false, id: null, merged: false, previousQuantity: null })
    expect(rows('food_items')).toHaveLength(1)
  })

  it('deletes the row that a fresh insert created', async () => {
    const result = await saveFoodItem(base)
    await revertSaveFoodItem(result)
    expect(rows('food_items')).toHaveLength(0)
  })

  it('restores the pre-merge quantity instead of deleting the row', async () => {
    seed('food_items', [{ id: 'existing', name: 'Tomaten', unit: 'g', quantity: 100, location: 'pantry' }])
    const result = await saveFoodItem(base)
    expect(rows('food_items')[0].quantity).toBe(500)
    await revertSaveFoodItem(result)
    expect(rows('food_items')).toHaveLength(1)
    expect(rows('food_items')[0].quantity).toBe(100)
  })
})
