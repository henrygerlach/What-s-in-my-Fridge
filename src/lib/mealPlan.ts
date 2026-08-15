import { supabase } from './supabase'
import type { MealPlanItem, RecipeIngredient } from '../types'

// Local YYYY-MM-DD (not toISOString, which shifts to UTC and can land on the
// wrong day depending on timezone/time of day).
export function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const WEEKDAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export function formatDayLabel(date: Date): string {
  return `${WEEKDAY_LABELS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

export function upcomingDays(count: number, from: Date = new Date()): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(from)
    d.setDate(d.getDate() + i)
    return d
  })
}

export async function getMealPlanRange(startKey: string, endKey: string): Promise<MealPlanItem[]> {
  const { data } = await supabase
    .from('meal_plan_items')
    .select('*')
    .gte('plan_date', startKey)
    .lte('plan_date', endKey)
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function addMealPlanItem(planDate: string, recipeId: string, portions: number | null) {
  await supabase.from('meal_plan_items').insert({ plan_date: planDate, recipe_id: recipeId, portions })
}

export async function removeMealPlanItem(id: string) {
  await supabase.from('meal_plan_items').delete().eq('id', id)
}

interface AggregatedIngredient {
  name: string
  quantity: number | null
  unit: string | null
  grams_per_unit: number | null
}

// Combines ingredients from every planned recipe (each occurring possibly
// several times across the week) into one list per name+unit, so the "what's
// missing" check runs once against the combined amount instead of once per
// recipe — matching multiple recipes calling for the same ingredient
// shouldn't produce duplicate shopping list entries. Each occurrence's
// quantities are scaled by its ratio first (planned portions vs. the
// recipe's default portions), the same way RecipeDetail scales ingredients
// when cooking a different portion count. If any contributing occurrence has
// no quantity, the merged entry falls back to quantity-less (just check
// presence), same as a single recipe's ingredient with no amount.
export function aggregateIngredients(
  occurrences: Array<{ ingredients: RecipeIngredient[]; ratio: number }>,
): AggregatedIngredient[] {
  const merged = new Map<string, AggregatedIngredient>()

  for (const { ingredients, ratio } of occurrences) {
    for (const ingredient of ingredients) {
      const key = `${ingredient.name.trim().toLowerCase()}|${ingredient.unit ?? ''}`
      const existing = merged.get(key)
      const quantity = ingredient.quantity != null ? Math.round(ingredient.quantity * ratio * 100) / 100 : null

      if (!existing) {
        merged.set(key, {
          name: ingredient.name,
          quantity,
          unit: ingredient.unit,
          grams_per_unit: ingredient.grams_per_unit,
        })
        continue
      }

      if (existing.quantity == null || quantity == null) {
        existing.quantity = null
      } else {
        existing.quantity += quantity
      }
    }
  }

  return [...merged.values()]
}
