export type Location = 'fridge' | 'pantry' | 'freezer'

export interface FoodItem {
  id: string
  name: string
  category: string
  location: Location
  quantity: number | null
  unit: string | null
  grams_per_unit: number | null
  created_at: string
}

export interface Recipe {
  id: string
  title: string
  instructions: string
  photo_url: string | null
  category: string | null
  portions: number | null
  tags: string[]
  kcal_per_portion: number | null
  protein_g_per_portion: number | null
  fat_g_per_portion: number | null
  carbs_g_per_portion: number | null
  created_at: string
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  name: string
  quantity: number | null
  unit: string | null
  grams_per_unit: number | null
}

export interface MealPlanItem {
  id: string
  plan_date: string
  recipe_id: string
  portions: number | null
  created_at: string
}

export interface StapleItem {
  id: string
  name: string
  created_at: string
}
