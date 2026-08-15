import { supabase } from './supabase'
import { classifyItems } from './classify'

export interface ShoppingListItem {
  id: string
  name: string
  quantity: number | null
  unit: string | null
  category: string | null
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export async function getShoppingList(): Promise<ShoppingListItem[]> {
  const { data } = await supabase.from('shopping_list_items').select('*').order('created_at', { ascending: true })
  return data ?? []
}

// Merges into an existing entry with the same name and unit by summing
// quantities, so the same ingredient needed by multiple recipes ends up as
// one combined line instead of duplicates. `category` is optional since most
// callers (e.g. adding a missing recipe ingredient) don't know it — those
// entries just show up under "Ohne Kategorie" until bought. If the existing
// entry has no category yet and this call provides one, it's filled in.
export async function addToShoppingList(
  name: string,
  quantity: number | null = null,
  unit: string | null = null,
  category: string | null = null,
) {
  const trimmedName = name.trim()
  const normalized = normalizeName(trimmedName)
  const current = await getShoppingList()
  const existing = current.find((item) => normalizeName(item.name) === normalized && item.unit === unit)

  if (!existing) {
    await supabase.from('shopping_list_items').insert({ name: trimmedName, quantity, unit, category })
    return
  }

  const mergedQuantity =
    existing.quantity == null && quantity == null ? null : (existing.quantity ?? 0) + (quantity ?? 0)
  const mergedCategory = existing.category ?? category
  await supabase
    .from('shopping_list_items')
    .update({ quantity: mergedQuantity, category: mergedCategory })
    .eq('id', existing.id)
}

interface MissingIngredient {
  name: string
  quantity: number | null
  unit: string | null
}

// Adds several missing recipe ingredients to the shopping list at once,
// classifying all of them into categories in a single edge function call
// first — so a recipe's missing ingredients land in the same category
// groups as the rest of the shopping list instead of piling up under
// "Ohne Kategorie". Classification is best-effort: if it fails, items still
// get added, just without a category.
export async function addMissingIngredientsToShoppingList(ingredients: MissingIngredient[]): Promise<number> {
  if (ingredients.length === 0) return 0

  const categoryByName = await classifyItems(ingredients.map((i) => i.name))
  await Promise.all(
    ingredients.map((ingredient) =>
      addToShoppingList(ingredient.name, ingredient.quantity, ingredient.unit, categoryByName.get(ingredient.name.trim()) || null),
    ),
  )
  return ingredients.length
}

export async function updateShoppingListItem(
  id: string,
  patch: Partial<Pick<ShoppingListItem, 'quantity' | 'unit'>>,
) {
  await supabase.from('shopping_list_items').update(patch).eq('id', id)
}

export async function removeFromShoppingList(id: string) {
  await supabase.from('shopping_list_items').delete().eq('id', id)
}
