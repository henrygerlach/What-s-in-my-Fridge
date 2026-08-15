// One-off backfill: guesses nutrition for every existing recipe that
// predates auto-estimation on creation (see RecipeForm.tsx). Safe to
// re-run — it only touches recipes where kcal_per_portion is still null.
//
// Usage: node --env-file=.env scripts/backfill-nutrition.mjs

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (run with --env-file=.env).')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const { data: recipes, error: recipesError } = await supabase
  .from('recipes')
  .select('id, title, portions')
  .is('kcal_per_portion', null)

if (recipesError) {
  console.error('Failed to load recipes:', recipesError.message)
  process.exit(1)
}

console.log(`${recipes.length} recipe(s) without a nutrition estimate.`)

for (const recipe of recipes) {
  const { data: ingredients, error: ingredientsError } = await supabase
    .from('recipe_ingredients')
    .select('name, quantity, unit')
    .eq('recipe_id', recipe.id)

  if (ingredientsError) {
    console.log(`✗ "${recipe.title}": failed to load ingredients (${ingredientsError.message})`)
    continue
  }

  if (!ingredients || ingredients.length === 0) {
    console.log(`- "${recipe.title}": skipped, no ingredients`)
    continue
  }

  const { data: estimate, error: fnError } = await supabase.functions.invoke('estimate-nutrition', {
    body: { title: recipe.title, portions: recipe.portions ?? 1, ingredients },
  })

  if (fnError || !estimate) {
    console.log(`✗ "${recipe.title}": estimate failed (${fnError?.message ?? 'no data'})`)
    continue
  }

  const { error: updateError } = await supabase
    .from('recipes')
    .update({
      kcal_per_portion: estimate.kcal,
      protein_g_per_portion: estimate.protein_g,
      fat_g_per_portion: estimate.fat_g,
      carbs_g_per_portion: estimate.carbs_g,
    })
    .eq('id', recipe.id)

  if (updateError) {
    console.log(`✗ "${recipe.title}": failed to save estimate (${updateError.message})`)
    continue
  }

  console.log(`✓ "${recipe.title}": ${estimate.kcal} kcal/Portion`)
}

console.log('Done.')
