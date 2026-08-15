import { supabase } from './supabase'
import type { FoodItem } from '../types'

export type ConsumptionSource = 'manual' | 'cooked'

export interface ConsumptionLogEntry {
  id: string
  name: string
  category: string | null
  quantity: number | null
  unit: string | null
  reason: 'consumed' | 'discarded'
  source: ConsumptionSource
  recipe_title: string | null
  item_added_at: string | null
  logged_at: string
}

export interface LogConsumptionOptions {
  // Amount actually removed, when it differs from the item's full remaining
  // quantity (e.g. a partial "Verbraucht" or a recipe deducting only part of
  // a stack) — defaults to the item's full quantity.
  quantity?: number | null
  source?: ConsumptionSource
  recipeTitle?: string | null
}

export async function logConsumption(
  item: FoodItem,
  reason: 'consumed' | 'discarded',
  options?: LogConsumptionOptions,
) {
  await supabase.from('consumption_log').insert({
    name: item.name,
    category: item.category || null,
    quantity: options?.quantity ?? item.quantity,
    unit: item.unit,
    reason,
    source: options?.source ?? 'manual',
    recipe_title: options?.recipeTitle ?? null,
    item_added_at: item.created_at,
  })
}

export async function loadRecentConsumptionLog(sinceIso: string): Promise<ConsumptionLogEntry[]> {
  const { data } = await supabase
    .from('consumption_log')
    .select('*')
    .gte('logged_at', sinceIso)
    .order('logged_at', { ascending: false })
  return data ?? []
}
