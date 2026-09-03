import { describe, it, expect, vi } from 'vitest'
import {
  getShoppingList,
  addToShoppingList,
  addMissingIngredientsToShoppingList,
  updateShoppingListItem,
  removeFromShoppingList,
} from './shoppingList'
import { seed, rows, functionsInvoke } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('getShoppingList', () => {
  it('returns an empty list when the table is empty', async () => {
    expect(await getShoppingList()).toEqual([])
  })

  it('returns entries oldest first', async () => {
    seed('shopping_list_items', [
      { id: 'b', name: 'Milch', created_at: '2026-06-02T00:00:00.000Z' },
      { id: 'a', name: 'Brot', created_at: '2026-06-01T00:00:00.000Z' },
    ])
    expect((await getShoppingList()).map((item) => item.name)).toEqual(['Brot', 'Milch'])
  })
})

describe('addToShoppingList', () => {
  it('inserts a new entry with the trimmed name', async () => {
    await addToShoppingList('  Milch ', 1, 'l', 'Milchprodukte & Eier')
    expect(rows('shopping_list_items')).toHaveLength(1)
    expect(rows('shopping_list_items')[0]).toMatchObject({
      name: 'Milch',
      quantity: 1,
      unit: 'l',
      category: 'Milchprodukte & Eier',
    })
  })

  it('defaults quantity, unit and category to null', async () => {
    await addToShoppingList('Milch')
    expect(rows('shopping_list_items')[0]).toMatchObject({ quantity: null, unit: null, category: null })
  })

  it('sums quantities into an existing entry with the same name and unit', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: 1, unit: 'l', category: null }])
    await addToShoppingList('milch', 2, 'l')
    expect(rows('shopping_list_items')).toHaveLength(1)
    expect(rows('shopping_list_items')[0].quantity).toBe(3)
  })

  it('keeps a separate entry when the unit differs', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: 1, unit: 'l', category: null }])
    await addToShoppingList('Milch', 500, 'ml')
    expect(rows('shopping_list_items')).toHaveLength(2)
  })

  it('stays quantity-less when neither side has a quantity', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: null, unit: null, category: null }])
    await addToShoppingList('Milch')
    expect(rows('shopping_list_items')[0].quantity).toBeNull()
  })

  it('treats a missing quantity on one side as zero', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: null, unit: 'l', category: null }])
    await addToShoppingList('Milch', 2, 'l')
    expect(rows('shopping_list_items')[0].quantity).toBe(2)
  })

  it('fills in a category the existing entry was missing', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: 1, unit: 'l', category: null }])
    await addToShoppingList('Milch', 1, 'l', 'Milchprodukte & Eier')
    expect(rows('shopping_list_items')[0].category).toBe('Milchprodukte & Eier')
  })

  it('does not overwrite a category the existing entry already has', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: 1, unit: 'l', category: 'Getränke' }])
    await addToShoppingList('Milch', 1, 'l', 'Milchprodukte & Eier')
    expect(rows('shopping_list_items')[0].category).toBe('Getränke')
  })
})

describe('addMissingIngredientsToShoppingList', () => {
  it('adds nothing and makes no call for an empty list', async () => {
    expect(await addMissingIngredientsToShoppingList([])).toBe(0)
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('classifies the whole batch in one call and adds each ingredient', async () => {
    functionsInvoke.mockResolvedValue({ data: { categories: ['Obst & Gemüse', 'Milchprodukte & Eier'] }, error: null })
    const added = await addMissingIngredientsToShoppingList([
      { name: 'Tomaten', quantity: 400, unit: 'g' },
      { name: 'Milch', quantity: 1, unit: 'l' },
    ])
    expect(added).toBe(2)
    expect(functionsInvoke).toHaveBeenCalledTimes(1)
    expect(rows('shopping_list_items')).toHaveLength(2)
    expect(rows('shopping_list_items').map((item) => item.category)).toEqual([
      'Obst & Gemüse',
      'Milchprodukte & Eier',
    ])
  })

  // Classification is a nice-to-have; a failure must not stop the ingredients
  // from reaching the list.
  it('still adds the ingredients when classification fails', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const added = await addMissingIngredientsToShoppingList([{ name: 'Tomaten', quantity: 400, unit: 'g' }])
    expect(added).toBe(1)
    expect(rows('shopping_list_items')[0]).toMatchObject({ name: 'Tomaten', category: null })
  })

  it('passes null rather than an empty category string', async () => {
    functionsInvoke.mockResolvedValue({ data: { categories: [''] }, error: null })
    await addMissingIngredientsToShoppingList([{ name: 'Tomaten', quantity: 400, unit: 'g' }])
    expect(rows('shopping_list_items')[0].category).toBeNull()
  })
})

describe('updateShoppingListItem', () => {
  it('patches only the given fields', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Milch', quantity: 1, unit: 'l', category: 'Getränke' }])
    await updateShoppingListItem('a', { quantity: 3 })
    expect(rows('shopping_list_items')[0]).toMatchObject({ quantity: 3, unit: 'l', category: 'Getränke' })
  })
})

describe('removeFromShoppingList', () => {
  it('deletes only the matching entry', async () => {
    seed('shopping_list_items', [
      { id: 'a', name: 'Milch' },
      { id: 'b', name: 'Brot' },
    ])
    await removeFromShoppingList('a')
    expect(rows('shopping_list_items').map((item) => item.name)).toEqual(['Brot'])
  })
})
