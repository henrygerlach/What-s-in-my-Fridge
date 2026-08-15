import { supabase } from './supabase'
import { isIngredientAvailable } from './stock'
import type { Recipe, RecipeIngredient } from '../types'

export interface RecipeWithAvailability extends Recipe {
  total: number
  available: number
}

// Loads all recipes together with how many of their ingredients are
// currently in stock, sorted with the most-ready-to-cook recipes first —
// shared by the recipe list and the "what can I cook" inventory widget.
export async function loadRecipesWithAvailability(): Promise<RecipeWithAvailability[]> {
  const [{ data: recipeRows }, { data: ingredientRows }, { data: foodItems }] = await Promise.all([
    supabase.from('recipes').select('*'),
    supabase.from('recipe_ingredients').select('*'),
    supabase.from('food_items').select('*'),
  ])

  const ingredientsByRecipe = new Map<string, RecipeIngredient[]>()
  for (const ingredient of ingredientRows ?? []) {
    const list = ingredientsByRecipe.get(ingredient.recipe_id) ?? []
    list.push(ingredient)
    ingredientsByRecipe.set(ingredient.recipe_id, list)
  }

  const withAvailability = (recipeRows ?? []).map((recipe) => {
    const ingredients = ingredientsByRecipe.get(recipe.id) ?? []
    const available = ingredients.filter((ingredient) => isIngredientAvailable(ingredient, foodItems ?? [])).length
    return { ...recipe, total: ingredients.length, available }
  })

  withAvailability.sort((a, b) => {
    const ratioA = a.total ? a.available / a.total : 0
    const ratioB = b.total ? b.available / b.total : 0
    return ratioB - ratioA
  })

  return withAvailability
}
