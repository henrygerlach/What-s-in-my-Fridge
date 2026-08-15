import { supabase } from './supabase'
import type { Location } from '../types'

export interface ClassificationResult {
  category: string
  location: Location
}

export async function classifyItem(name: string): Promise<ClassificationResult | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const { data, error } = await supabase.functions.invoke('classify-item', { body: { name: trimmed } })
  if (error || !data) return null

  return { category: data.category ?? '', location: (data.location as Location) ?? 'fridge' }
}

// Classifies several item names in a single LLM call, keyed by the original
// (untrimmed) name — cheaper and faster than one classifyItem call per item
// when adding a batch of missing ingredients to the shopping list. Falls
// back to an empty map on failure so callers can just skip categorizing
// rather than blocking the add.
export async function classifyItems(names: string[]): Promise<Map<string, string>> {
  const trimmedNames = names.map((name) => name.trim()).filter(Boolean)
  if (trimmedNames.length === 0) return new Map()

  const { data, error } = await supabase.functions.invoke('classify-items', { body: { names: trimmedNames } })
  if (error || !Array.isArray(data?.categories)) return new Map()

  return new Map(trimmedNames.map((name, i) => [name, data.categories[i] ?? '']))
}
