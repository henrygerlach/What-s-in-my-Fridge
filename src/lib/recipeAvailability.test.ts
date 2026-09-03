import { describe, it, expect, vi } from 'vitest'
import { loadRecipesWithAvailability } from './recipeAvailability'
import { seed } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('loadRecipesWithAvailability', () => {
  it('returns nothing when there are no recipes', async () => {
    expect(await loadRecipesWithAvailability()).toEqual([])
  })

  it('counts a recipe with no ingredients as zero of zero', async () => {
    seed('recipes', [{ id: 'r1', title: 'Leeres Rezept' }])
    expect(await loadRecipesWithAvailability()).toEqual([
      expect.objectContaining({ id: 'r1', total: 0, available: 0 }),
    ])
  })

  it('counts how many ingredients are actually in stock', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_ingredients', [
      { recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' },
      { recipe_id: 'r1', name: 'Bohnen', quantity: 200, unit: 'g' },
    ])
    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    const [recipe] = await loadRecipesWithAvailability()
    expect(recipe).toMatchObject({ total: 2, available: 1 })
  })

  it('sorts the most-cookable recipe first', async () => {
    seed('recipes', [
      { id: 'partial', title: 'Halb' },
      { id: 'ready', title: 'Fertig' },
    ])
    seed('recipe_ingredients', [
      { recipe_id: 'partial', name: 'Tomaten', quantity: 400, unit: 'g' },
      { recipe_id: 'partial', name: 'Bohnen', quantity: 200, unit: 'g' },
      { recipe_id: 'ready', name: 'Tomaten', quantity: 100, unit: 'g' },
    ])
    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    expect((await loadRecipesWithAvailability()).map((recipe) => recipe.id)).toEqual(['ready', 'partial'])
  })

  it('ranks an empty recipe below a fully-stocked one', async () => {
    seed('recipes', [{ id: 'empty', title: 'Leer' }, { id: 'ready', title: 'Fertig' }])
    seed('recipe_ingredients', [{ recipe_id: 'ready', name: 'Tomaten', quantity: 100, unit: 'g' }])
    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    expect((await loadRecipesWithAvailability()).map((recipe) => recipe.id)).toEqual(['ready', 'empty'])
  })

  it('ignores ingredients belonging to other recipes', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_ingredients', [{ recipe_id: 'other', name: 'Tomaten', quantity: 400, unit: 'g' }])
    const [recipe] = await loadRecipesWithAvailability()
    expect(recipe.total).toBe(0)
  })
})
