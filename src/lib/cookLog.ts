import { supabase } from './supabase'

export interface CookLogEntry {
  recipe_id: string
  cooked_at: string
  recipe_title: string | null
}

export async function logCookedRecipe(recipeId: string) {
  await supabase.from('recipe_cook_log').insert({ recipe_id: recipeId })
}

// Joins in the recipe title at read time so cooking-frequency stats can show
// "Lieblingsgericht" even if the recipe list itself isn't loaded, and stays
// null (rather than failing) for recipes that were since deleted.
export async function loadRecentCookLog(sinceIso: string): Promise<CookLogEntry[]> {
  const { data } = await supabase
    .from('recipe_cook_log')
    .select('recipe_id, cooked_at, recipes(title)')
    .gte('cooked_at', sinceIso)
    .order('cooked_at', { ascending: false })

  return (data ?? []).map((row) => {
    const recipe = row.recipes as unknown as { title: string } | { title: string }[] | null
    const title = Array.isArray(recipe) ? (recipe[0]?.title ?? null) : (recipe?.title ?? null)
    return { recipe_id: row.recipe_id, cooked_at: row.cooked_at, recipe_title: title }
  })
}

// Latest cooked_at per recipe, for showing "zuletzt gekocht: vor X Tagen" in
// recipe lists without a separate round trip per recipe.
export async function loadLastCookedMap(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('recipe_cook_log')
    .select('recipe_id, cooked_at')
    .order('cooked_at', { ascending: false })

  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (!map.has(row.recipe_id)) map.set(row.recipe_id, row.cooked_at)
  }
  return map
}
