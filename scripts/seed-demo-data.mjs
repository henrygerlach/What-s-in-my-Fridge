// Fills the app with realistic example data for a showcase/demo: inventory
// items across all locations, recipes with ingredients, a shopping list,
// staples, an upcoming meal plan, and 30 days of history (inventory log,
// consumption log, cook log) so the stats pages aren't empty either.
//
// DESTRUCTIVE: first wipes every row from every table this script touches
// (food_items, recipes + recipe_ingredients, shopping_list_items,
// staple_items, meal_plan_items, inventory_log, consumption_log,
// recipe_cook_log), so the demo data always starts from a clean slate. Do
// not run this against a database with real data you want to keep.
//
// Usage: node --env-file=.env scripts/seed-demo-data.mjs

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (run with --env-file=.env).')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

function daysAgo(days, hour = 12) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function daysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Tables in child-before-parent order, so foreign keys never block a delete
// even though they'd cascade anyway (recipe_ingredients/recipe_cook_log/
// meal_plan_items all reference recipes with on delete cascade).
const TABLES_TO_CLEAR = [
  'recipe_ingredients',
  'recipe_cook_log',
  'meal_plan_items',
  'recipes',
  'consumption_log',
  'inventory_log',
  'food_items',
  'shopping_list_items',
  'staple_items',
]

async function clearAll() {
  for (const table of TABLES_TO_CLEAR) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null)
    if (error) {
      console.error(`Failed clearing ${table}:`, error.message)
      continue
    }
    console.log(`Cleared ${table}.`)
  }
}

async function insertMany(table, rows, label) {
  const { data, error } = await supabase.from(table).insert(rows).select()
  if (error) {
    console.error(`Failed inserting ${label}:`, error.message)
    return []
  }
  console.log(`Inserted ${data.length} ${label}.`)
  return data
}

// ---------------------------------------------------------------------------
// Inventory (food_items)
// ---------------------------------------------------------------------------

const foodItems = [
  // Kühlschrank
  { name: 'Milch', category: 'Milchprodukte & Eier', location: 'fridge', quantity: 1, unit: 'l' },
  { name: 'Eier', category: 'Milchprodukte & Eier', location: 'fridge', quantity: 10, unit: 'Stück' },
  { name: 'Naturjoghurt', category: 'Milchprodukte & Eier', location: 'fridge', quantity: 2, unit: 'Stück' },
  { name: 'Butter', category: 'Milchprodukte & Eier', location: 'fridge', quantity: 1, unit: 'Packung', grams_per_unit: 250 },
  { name: 'Feta', category: 'Milchprodukte & Eier', location: 'fridge', quantity: 1, unit: 'Packung', grams_per_unit: 200 },
  { name: 'Karotten', category: 'Obst & Gemüse', location: 'fridge', quantity: 500, unit: 'g' },
  { name: 'Paprika', category: 'Obst & Gemüse', location: 'fridge', quantity: 4, unit: 'Stück' },
  { name: 'Äpfel', category: 'Obst & Gemüse', location: 'fridge', quantity: 6, unit: 'Stück' },
  { name: 'Gurke', category: 'Obst & Gemüse', location: 'fridge', quantity: 1, unit: 'Stück' },
  { name: 'Hähnchenbrust', category: 'Fleisch & Fisch', location: 'fridge', quantity: 400, unit: 'g' },
  { name: 'Lachsfilet', category: 'Fleisch & Fisch', location: 'fridge', quantity: 2, unit: 'Stück' },
  { name: 'Orangensaft', category: 'Getränke', location: 'fridge', quantity: 1, unit: 'l' },
  // Vorrat
  { name: 'Reis', category: 'Konserven & Grundnahrungsmittel', location: 'pantry', quantity: 1, unit: 'kg' },
  { name: 'Nudeln', category: 'Konserven & Grundnahrungsmittel', location: 'pantry', quantity: 2, unit: 'Packung' },
  {
    name: 'Passierte Tomaten',
    category: 'Konserven & Grundnahrungsmittel',
    location: 'pantry',
    quantity: 3,
    unit: 'Dose',
    grams_per_unit: 400,
  },
  {
    name: 'Kichererbsen',
    category: 'Konserven & Grundnahrungsmittel',
    location: 'pantry',
    quantity: 2,
    unit: 'Dose',
    grams_per_unit: 400,
  },
  {
    name: 'Kokosmilch',
    category: 'Konserven & Grundnahrungsmittel',
    location: 'pantry',
    quantity: 1,
    unit: 'Dose',
    grams_per_unit: 400,
  },
  { name: 'Mehl', category: 'Konserven & Grundnahrungsmittel', location: 'pantry', quantity: 1, unit: 'kg' },
  { name: 'Zucker', category: 'Konserven & Grundnahrungsmittel', location: 'pantry', quantity: 1, unit: 'kg' },
  { name: 'Haferflocken', category: 'Konserven & Grundnahrungsmittel', location: 'pantry', quantity: 500, unit: 'g' },
  { name: 'Olivenöl', category: 'Gewürze & Saucen', location: 'pantry', quantity: 0.75, unit: 'l' },
  { name: 'Salz', category: 'Gewürze & Saucen', location: 'pantry', quantity: 1, unit: 'Packung' },
  { name: 'Currypaste', category: 'Gewürze & Saucen', location: 'pantry', quantity: 1, unit: 'Glas' },
  { name: 'Vollkornbrot', category: 'Brot & Backwaren', location: 'pantry', quantity: 1, unit: 'Stück' },
  { name: 'Kaffee', category: 'Getränke', location: 'pantry', quantity: 1, unit: 'Packung' },
  { name: 'Schokolade', category: 'Süßigkeiten & Snacks', location: 'pantry', quantity: 3, unit: 'Stück' },
  // Tiefkühl
  { name: 'Erbsen (TK)', category: 'Tiefkühl', location: 'freezer', quantity: 500, unit: 'g' },
  { name: 'Beeren Mix (TK)', category: 'Tiefkühl', location: 'freezer', quantity: 400, unit: 'g' },
  { name: 'Pizza', category: 'Tiefkühl', location: 'freezer', quantity: 2, unit: 'Stück' },
  { name: 'Pommes', category: 'Tiefkühl', location: 'freezer', quantity: 750, unit: 'g' },
]

// ---------------------------------------------------------------------------
// Recipes + ingredients
// ---------------------------------------------------------------------------

const recipes = [
  {
    title: 'Pasta Pomodoro',
    category: 'Große Mahlzeit',
    portions: 4,
    tags: ['Vegetarisch', '20–40 Min.', 'Günstig'],
    instructions:
      'Nudeln in Salzwasser kochen. Knoblauch in Olivenöl anschwitzen, passierte Tomaten dazugeben und 15 Minuten köcheln lassen. Mit Salz abschmecken, Basilikum und Parmesan über die abgetropften Nudeln geben.',
    kcal_per_portion: 620,
    protein_g_per_portion: 18,
    fat_g_per_portion: 16,
    carbs_g_per_portion: 95,
    ingredients: [
      { name: 'Nudeln', quantity: 400, unit: 'g' },
      { name: 'Passierte Tomaten', quantity: 2, unit: 'Dose', grams_per_unit: 400 },
      { name: 'Knoblauch', quantity: 2, unit: 'Stück' },
      { name: 'Olivenöl', quantity: 30, unit: 'ml' },
      { name: 'Basilikum', quantity: 1, unit: 'Bund' },
      { name: 'Parmesan', quantity: 50, unit: 'g' },
    ],
  },
  {
    title: 'Hähnchen-Curry mit Reis',
    category: 'Große Mahlzeit',
    portions: 3,
    tags: ['Fleisch', '20–40 Min.'],
    instructions:
      'Hähnchenbrust in Streifen schneiden und anbraten. Zwiebel und Paprika dazugeben, kurz mitbraten. Currypaste einrühren, Kokosmilch angießen und 10 Minuten köcheln lassen. Mit Reis servieren.',
    kcal_per_portion: 580,
    protein_g_per_portion: 38,
    fat_g_per_portion: 20,
    carbs_g_per_portion: 55,
    ingredients: [
      { name: 'Hähnchenbrust', quantity: 400, unit: 'g' },
      { name: 'Reis', quantity: 300, unit: 'g' },
      { name: 'Kokosmilch', quantity: 1, unit: 'Dose', grams_per_unit: 400 },
      { name: 'Currypaste', quantity: 1, unit: 'Glas' },
      { name: 'Paprika', quantity: 2, unit: 'Stück' },
      { name: 'Karotten', quantity: 200, unit: 'g' },
      { name: 'Zwiebel', quantity: 1, unit: 'Stück' },
    ],
  },
  {
    title: 'Lachs mit Gemüse',
    category: 'Große Mahlzeit',
    portions: 2,
    tags: ['Fisch', '20–40 Min.'],
    instructions:
      'Lachsfilets salzen und in Olivenöl von beiden Seiten braten. Brokkoli dämpfen. Mit Zitronensaft beträufeln und servieren.',
    kcal_per_portion: 510,
    protein_g_per_portion: 34,
    fat_g_per_portion: 28,
    carbs_g_per_portion: 12,
    ingredients: [
      { name: 'Lachsfilet', quantity: 2, unit: 'Stück' },
      { name: 'Brokkoli', quantity: 300, unit: 'g' },
      { name: 'Zitrone', quantity: 1, unit: 'Stück' },
      { name: 'Olivenöl', quantity: 20, unit: 'ml' },
      { name: 'Salz', quantity: 1, unit: 'Prise' },
    ],
  },
  {
    title: 'Kichererbsen-Salat',
    category: 'Große Mahlzeit',
    portions: 2,
    tags: ['Vegan', '< 10 Min.', 'Meal Prep'],
    instructions:
      'Kichererbsen abtropfen lassen. Gurke und Paprika würfeln. Alles mit Olivenöl und Zitronensaft vermengen und abschmecken.',
    kcal_per_portion: 380,
    protein_g_per_portion: 14,
    fat_g_per_portion: 16,
    carbs_g_per_portion: 45,
    ingredients: [
      { name: 'Kichererbsen', quantity: 1, unit: 'Dose', grams_per_unit: 400 },
      { name: 'Gurke', quantity: 1, unit: 'Stück' },
      { name: 'Paprika', quantity: 1, unit: 'Stück' },
      { name: 'Olivenöl', quantity: 20, unit: 'ml' },
      { name: 'Zitrone', quantity: 1, unit: 'Stück' },
    ],
  },
  {
    title: 'Rührei mit Toast',
    category: 'Frühstück',
    portions: 2,
    tags: ['Vegetarisch', '< 10 Min.'],
    instructions: 'Eier verquirlen und in Butter bei mittlerer Hitze stocken lassen. Mit Salz würzen, mit geröstetem Vollkornbrot servieren.',
    kcal_per_portion: 420,
    protein_g_per_portion: 24,
    fat_g_per_portion: 28,
    carbs_g_per_portion: 18,
    ingredients: [
      { name: 'Eier', quantity: 4, unit: 'Stück' },
      { name: 'Butter', quantity: 20, unit: 'g' },
      { name: 'Vollkornbrot', quantity: 4, unit: 'Stück' },
      { name: 'Salz', quantity: 1, unit: 'Prise' },
    ],
  },
  {
    title: 'Overnight Oats',
    category: 'Frühstück',
    portions: 2,
    tags: ['Vegetarisch', 'Meal Prep'],
    instructions: 'Haferflocken mit Milch vermengen, über Nacht im Kühlschrank quellen lassen. Vor dem Essen mit Beeren und Honig toppen.',
    kcal_per_portion: 340,
    protein_g_per_portion: 12,
    fat_g_per_portion: 9,
    carbs_g_per_portion: 52,
    ingredients: [
      { name: 'Haferflocken', quantity: 80, unit: 'g' },
      { name: 'Milch', quantity: 200, unit: 'ml' },
      { name: 'Beeren Mix (TK)', quantity: 50, unit: 'g' },
      { name: 'Honig', quantity: 15, unit: 'ml' },
    ],
  },
  {
    title: 'Obstsalat mit Joghurt',
    category: 'Snack',
    portions: 2,
    tags: ['Vegetarisch', 'Kinderfreundlich', '< 10 Min.'],
    instructions: 'Äpfel würfeln, mit Beeren und Naturjoghurt vermischen.',
    kcal_per_portion: 190,
    protein_g_per_portion: 6,
    fat_g_per_portion: 3,
    carbs_g_per_portion: 34,
    ingredients: [
      { name: 'Äpfel', quantity: 2, unit: 'Stück' },
      { name: 'Beeren Mix (TK)', quantity: 100, unit: 'g' },
      { name: 'Naturjoghurt', quantity: 1, unit: 'Stück' },
    ],
  },
  {
    title: 'Gemüsepfanne mit Erbsen',
    category: 'Große Mahlzeit',
    portions: 3,
    tags: ['Vegetarisch', 'Resteverwertung', '20–40 Min.'],
    instructions: 'Reis kochen. Karotten und Paprika anbraten, Erbsen dazugeben und kurz mitbraten. Mit Reis servieren.',
    kcal_per_portion: 340,
    protein_g_per_portion: 10,
    fat_g_per_portion: 12,
    carbs_g_per_portion: 46,
    ingredients: [
      { name: 'Erbsen (TK)', quantity: 300, unit: 'g' },
      { name: 'Karotten', quantity: 200, unit: 'g' },
      { name: 'Paprika', quantity: 1, unit: 'Stück' },
      { name: 'Reis', quantity: 200, unit: 'g' },
      { name: 'Olivenöl', quantity: 20, unit: 'ml' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Shopping list & staples
// ---------------------------------------------------------------------------

const shoppingListItems = [
  { name: 'Bananen', quantity: 1, unit: 'Bund', category: 'Obst & Gemüse' },
  { name: 'Hackfleisch', quantity: 500, unit: 'g', category: 'Fleisch & Fisch' },
  { name: 'Frischkäse', quantity: 1, unit: 'Packung', category: 'Milchprodukte & Eier' },
  { name: 'Limonade', quantity: 2, unit: 'Stück', category: 'Getränke' },
  { name: 'Zitronen', quantity: 4, unit: 'Stück', category: 'Obst & Gemüse' },
  { name: 'Zwiebeln', quantity: 1, unit: 'Bund', category: 'Obst & Gemüse' },
  { name: 'Toilettenpapier', quantity: 1, unit: 'Packung', category: 'Sonstiges' },
  { name: 'Zahnpasta', quantity: null, unit: null, category: null },
]

const stapleItems = ['Reis', 'Nudeln', 'Olivenöl', 'Eier', 'Milch', 'Salz', 'Zwiebeln']

async function main() {
  console.log(`Seeding demo data into ${supabaseUrl} ...\n`)

  console.log('Clearing existing data...')
  await clearAll()
  console.log()

  await insertMany('food_items', foodItems, 'inventory items')

  const insertedRecipes = []
  for (const recipe of recipes) {
    const { ingredients, ...recipePayload } = recipe
    const { data: recipeRow, error: recipeError } = await supabase
      .from('recipes')
      .insert(recipePayload)
      .select()
      .single()
    if (recipeError || !recipeRow) {
      console.error(`Failed inserting recipe "${recipe.title}":`, recipeError?.message)
      continue
    }
    const { error: ingredientsError } = await supabase
      .from('recipe_ingredients')
      .insert(ingredients.map((ingredient) => ({ ...ingredient, recipe_id: recipeRow.id })))
    if (ingredientsError) {
      console.error(`Failed inserting ingredients for "${recipe.title}":`, ingredientsError.message)
    }
    insertedRecipes.push(recipeRow)
  }
  console.log(`Inserted ${insertedRecipes.length} recipes with ingredients.`)

  await insertMany('shopping_list_items', shoppingListItems, 'shopping list items')
  await insertMany(
    'staple_items',
    stapleItems.map((name) => ({ name })),
    'staple items',
  )

  if (insertedRecipes.length > 0) {
    const byTitle = Object.fromEntries(insertedRecipes.map((r) => [r.title, r]))
    const mealPlan = [
      { day: 0, title: 'Rührei mit Toast', portions: 2 },
      { day: 1, title: 'Pasta Pomodoro', portions: 4 },
      { day: 2, title: 'Hähnchen-Curry mit Reis', portions: 3 },
      { day: 2, title: 'Overnight Oats', portions: 2 },
      { day: 3, title: 'Lachs mit Gemüse', portions: 2 },
      { day: 4, title: 'Gemüsepfanne mit Erbsen', portions: 3 },
      { day: 5, title: 'Kichererbsen-Salat', portions: 2 },
      { day: 6, title: 'Obstsalat mit Joghurt', portions: 2 },
    ]
      .filter((entry) => byTitle[entry.title])
      .map((entry) => ({
        plan_date: daysFromNow(entry.day),
        recipe_id: byTitle[entry.title].id,
        portions: entry.portions,
      }))
    await insertMany('meal_plan_items', mealPlan, 'meal plan entries')
  }

  // -------------------------------------------------------------------------
  // 30 days of history, so WasteStats / cook history aren't empty
  // -------------------------------------------------------------------------

  const inventoryLog = [
    { name: 'Milch', category: 'Milchprodukte & Eier', quantity: 1, unit: 'l', location: 'fridge', source: 'shopping', logged_at: daysAgo(28) },
    { name: 'Eier', category: 'Milchprodukte & Eier', quantity: 10, unit: 'Stück', location: 'fridge', source: 'shopping', logged_at: daysAgo(28) },
    { name: 'Hähnchenbrust', category: 'Fleisch & Fisch', quantity: 400, unit: 'g', location: 'fridge', source: 'receipt', logged_at: daysAgo(24) },
    { name: 'Bananen', category: 'Obst & Gemüse', quantity: 6, unit: 'Stück', location: 'fridge', source: 'manual', logged_at: daysAgo(22) },
    { name: 'Nudeln', category: 'Konserven & Grundnahrungsmittel', quantity: 2, unit: 'Packung', location: 'pantry', source: 'shopping', logged_at: daysAgo(20) },
    { name: 'Joghurt', category: 'Milchprodukte & Eier', quantity: 4, unit: 'Stück', location: 'fridge', source: 'photo', logged_at: daysAgo(18) },
    { name: 'Paprika', category: 'Obst & Gemüse', quantity: 3, unit: 'Stück', location: 'fridge', source: 'manual', logged_at: daysAgo(16) },
    { name: 'Lachsfilet', category: 'Fleisch & Fisch', quantity: 2, unit: 'Stück', location: 'fridge', source: 'receipt', logged_at: daysAgo(14) },
    { name: 'Erbsen (TK)', category: 'Tiefkühl', quantity: 500, unit: 'g', location: 'freezer', source: 'shopping', logged_at: daysAgo(12) },
    { name: 'Kichererbsen', category: 'Konserven & Grundnahrungsmittel', quantity: 2, unit: 'Dose', location: 'pantry', source: 'shopping', logged_at: daysAgo(10) },
    { name: 'Karotten', category: 'Obst & Gemüse', quantity: 500, unit: 'g', location: 'fridge', source: 'manual', logged_at: daysAgo(8) },
    { name: 'Vollkornbrot', category: 'Brot & Backwaren', quantity: 1, unit: 'Stück', location: 'pantry', source: 'manual', logged_at: daysAgo(6) },
    { name: 'Äpfel', category: 'Obst & Gemüse', quantity: 6, unit: 'Stück', location: 'fridge', source: 'photo', logged_at: daysAgo(4) },
    { name: 'Pizza', category: 'Tiefkühl', quantity: 2, unit: 'Stück', location: 'freezer', source: 'shopping', logged_at: daysAgo(3) },
    { name: 'Orangensaft', category: 'Getränke', quantity: 1, unit: 'l', location: 'fridge', source: 'manual', logged_at: daysAgo(1) },
  ]
  await insertMany('inventory_log', inventoryLog, 'inventory log entries')

  const consumptionLog = [
    { name: 'Bananen', category: 'Obst & Gemüse', quantity: 6, unit: 'Stück', reason: 'consumed', source: 'manual', logged_at: daysAgo(19), item_added_at: daysAgo(22) },
    { name: 'Joghurt', category: 'Milchprodukte & Eier', quantity: 2, unit: 'Stück', reason: 'discarded', source: 'manual', logged_at: daysAgo(9), item_added_at: daysAgo(18) },
    { name: 'Hähnchenbrust', category: 'Fleisch & Fisch', quantity: 400, unit: 'g', reason: 'consumed', source: 'cooked', recipe_title: 'Hähnchen-Curry mit Reis', logged_at: daysAgo(18), item_added_at: daysAgo(24) },
    { name: 'Eier', category: 'Milchprodukte & Eier', quantity: 4, unit: 'Stück', reason: 'consumed', source: 'cooked', recipe_title: 'Rührei mit Toast', logged_at: daysAgo(15), item_added_at: daysAgo(28) },
    { name: 'Nudeln', category: 'Konserven & Grundnahrungsmittel', quantity: 1, unit: 'Packung', reason: 'consumed', source: 'cooked', recipe_title: 'Pasta Pomodoro', logged_at: daysAgo(11), item_added_at: daysAgo(20) },
    { name: 'Paprika', category: 'Obst & Gemüse', quantity: 1, unit: 'Stück', reason: 'discarded', source: 'manual', logged_at: daysAgo(5), item_added_at: daysAgo(16) },
    { name: 'Lachsfilet', category: 'Fleisch & Fisch', quantity: 2, unit: 'Stück', reason: 'consumed', source: 'cooked', recipe_title: 'Lachs mit Gemüse', logged_at: daysAgo(7), item_added_at: daysAgo(14) },
    { name: 'Karotten', category: 'Obst & Gemüse', quantity: 200, unit: 'g', reason: 'consumed', source: 'cooked', recipe_title: 'Gemüsepfanne mit Erbsen', logged_at: daysAgo(2), item_added_at: daysAgo(8) },
    { name: 'Vollkornbrot', category: 'Brot & Backwaren', quantity: 1, unit: 'Stück', reason: 'discarded', source: 'manual', logged_at: daysAgo(1), item_added_at: daysAgo(6) },
  ]
  await insertMany('consumption_log', consumptionLog, 'consumption log entries')

  if (insertedRecipes.length > 0) {
    const byTitle = Object.fromEntries(insertedRecipes.map((r) => [r.title, r]))
    const cookLog = [
      { title: 'Hähnchen-Curry mit Reis', daysAgo: 18 },
      { title: 'Rührei mit Toast', daysAgo: 15 },
      { title: 'Rührei mit Toast', daysAgo: 8 },
      { title: 'Pasta Pomodoro', daysAgo: 11 },
      { title: 'Pasta Pomodoro', daysAgo: 4 },
      { title: 'Lachs mit Gemüse', daysAgo: 7 },
      { title: 'Gemüsepfanne mit Erbsen', daysAgo: 2 },
      { title: 'Overnight Oats', daysAgo: 20 },
      { title: 'Overnight Oats', daysAgo: 13 },
      { title: 'Overnight Oats', daysAgo: 6 },
    ]
      .filter((entry) => byTitle[entry.title])
      .map((entry) => ({ recipe_id: byTitle[entry.title].id, cooked_at: daysAgo(entry.daysAgo) }))
    await insertMany('recipe_cook_log', cookLog, 'recipe cook log entries')
  }

  console.log('\nDone. Open the app to see the demo data.')
}

main()
