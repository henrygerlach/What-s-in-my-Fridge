import { supabase } from './supabase'
import type { RecipeIngredient } from '../types'

export interface NutritionEstimate {
  kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
}

export async function estimateNutrition(
  title: string,
  ingredients: RecipeIngredient[],
  portions: number,
): Promise<NutritionEstimate | null> {
  const { data, error } = await supabase.functions.invoke('estimate-nutrition', {
    body: {
      title,
      portions,
      ingredients: ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
    },
  })
  if (error || !data) return null
  return data as NutritionEstimate
}
