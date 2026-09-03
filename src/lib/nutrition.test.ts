import { describe, it, expect, vi } from 'vitest'
import { estimateNutrition } from './nutrition'
import { functionsInvoke } from '../test/fakeSupabase'
import type { RecipeIngredient } from '../types'

vi.mock('./supabase')

const ingredients = [
  { id: 'i1', recipe_id: 'r1', name: 'Mehl', quantity: 200, unit: 'g', grams_per_unit: null },
] as unknown as RecipeIngredient[]

describe('estimateNutrition', () => {
  it('sends only the fields the estimate needs', async () => {
    functionsInvoke.mockResolvedValue({ data: { kcal: 500, protein_g: 20, fat_g: 10, carbs_g: 60 }, error: null })
    const result = await estimateNutrition('Pfannkuchen', ingredients, 2)
    expect(functionsInvoke).toHaveBeenCalledWith('estimate-nutrition', {
      body: {
        title: 'Pfannkuchen',
        portions: 2,
        ingredients: [{ name: 'Mehl', quantity: 200, unit: 'g' }],
      },
    })
    expect(result).toEqual({ kcal: 500, protein_g: 20, fat_g: 10, carbs_g: 60 })
  })

  it('returns null when the estimate fails', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await estimateNutrition('Pfannkuchen', ingredients, 2)).toBeNull()

    functionsInvoke.mockResolvedValue({ data: null, error: null })
    expect(await estimateNutrition('Pfannkuchen', ingredients, 2)).toBeNull()
  })
})
