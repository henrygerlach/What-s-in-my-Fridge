import { supabase } from './supabase'
import { toComparableQuantity } from './stock'
import { logInventoryAddition } from './inventoryLog'
import type { InventorySource } from './inventoryLog'
import type { Location } from '../types'

export interface SaveFoodItemInput {
  name: string
  category: string
  quantity: number | null
  unit: string | null
  grams_per_unit?: number | null
  location: Location
  source: InventorySource
}

export interface SaveFoodItemResult {
  ok: boolean
  id: string | null
  merged: boolean
  previousQuantity: number | null
}

const FAILED_RESULT: SaveFoodItemResult = { ok: false, id: null, merged: false, previousQuantity: null }

// Merges into an existing entry with the same name (case-insensitive) and
// location instead of creating a duplicate row. Prefers an exact unit match;
// failing that, falls back to a candidate whose unit is convertible (via
// toComparableQuantity, using each row's grams_per_unit) so e.g. adding
// "250 g" merges into an existing "1 Packung" row once a weight factor makes
// the two comparable, instead of splitting the same item across units.
// Returns enough detail about what happened (new row vs. merge, and the
// pre-merge quantity) for callers that need to undo the write.
export async function saveFoodItem(input: SaveFoodItemInput): Promise<SaveFoodItemResult> {
  const trimmedName = input.name.trim()
  if (!trimmedName) return FAILED_RESULT

  const { data: candidates } = await supabase
    .from('food_items')
    .select('*')
    .eq('location', input.location)
    .ilike('name', trimmedName)

  const sameNameCandidates = (candidates ?? []).filter(
    (item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  )

  const exactUnitMatch = sameNameCandidates.find((item) => (item.unit ?? null) === input.unit)
  if (exactUnitMatch) {
    const mergedQuantity = (exactUnitMatch.quantity ?? 0) + (input.quantity ?? 0)
    const { error } = await supabase
      .from('food_items')
      .update({ quantity: mergedQuantity })
      .eq('id', exactUnitMatch.id)
    if (error) return FAILED_RESULT
    void logInventoryAddition({
      name: trimmedName,
      category: input.category || null,
      quantity: input.quantity,
      unit: input.unit,
      location: input.location,
      source: input.source,
    })
    return { ok: true, id: exactUnitMatch.id, merged: true, previousQuantity: exactUnitMatch.quantity }
  }

  if (input.quantity != null) {
    for (const candidate of sameNameCandidates) {
      const addedInCandidateUnit = toComparableQuantity(
        input.quantity,
        input.unit,
        candidate.unit,
        input.grams_per_unit,
        candidate.grams_per_unit,
      )
      if (addedInCandidateUnit == null) continue

      const mergedQuantity = (candidate.quantity ?? 0) + addedInCandidateUnit
      const { error } = await supabase.from('food_items').update({ quantity: mergedQuantity }).eq('id', candidate.id)
      if (error) return FAILED_RESULT
      void logInventoryAddition({
        name: trimmedName,
        category: input.category || null,
        quantity: input.quantity,
        unit: input.unit,
        location: input.location,
        source: input.source,
      })
      return { ok: true, id: candidate.id, merged: true, previousQuantity: candidate.quantity }
    }
  }

  const { data, error } = await supabase
    .from('food_items')
    .insert({
      name: trimmedName,
      category: input.category,
      location: input.location,
      quantity: input.quantity,
      unit: input.unit,
      grams_per_unit: input.grams_per_unit ?? null,
    })
    .select()
    .single()
  if (error || !data) return FAILED_RESULT

  void logInventoryAddition({
    name: trimmedName,
    category: input.category || null,
    quantity: input.quantity,
    unit: input.unit,
    location: input.location,
    source: input.source,
  })
  return { ok: true, id: data.id, merged: false, previousQuantity: null }
}

export async function revertSaveFoodItem(result: SaveFoodItemResult) {
  if (!result.id) return
  if (result.merged) {
    await supabase.from('food_items').update({ quantity: result.previousQuantity }).eq('id', result.id)
  } else {
    await supabase.from('food_items').delete().eq('id', result.id)
  }
}
