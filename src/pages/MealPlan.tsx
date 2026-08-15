import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { useClickOutside } from '../lib/useClickOutside'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { getMissingIngredients } from '../lib/stock'
import { addMissingIngredientsToShoppingList } from '../lib/shoppingList'
import BackLink from '../components/BackLink'
import {
  addMealPlanItem,
  aggregateIngredients,
  formatDateKey,
  formatDayLabel,
  getMealPlanRange,
  removeMealPlanItem,
  upcomingDays,
} from '../lib/mealPlan'
import type { MealPlanItem, RecipeIngredient } from '../types'

const DAYS_AHEAD = 7

interface RecipeOption {
  id: string
  title: string
  portions: number | null
}

export default function MealPlan() {
  const days = upcomingDays(DAYS_AHEAD)
  const startKey = formatDateKey(days[0])
  const endKey = formatDateKey(days[days.length - 1])

  const [planItems, setPlanItems] = useState<MealPlanItem[]>([])
  const [recipes, setRecipes] = useState<RecipeOption[]>([])
  const [loading, setLoading] = useState(true)
  // dayKey of the currently open picker, so each day gets its own popover.
  const [pickerKey, setPickerKey] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pendingRecipe, setPendingRecipe] = useState<RecipeOption | null>(null)
  const [pendingPortions, setPendingPortions] = useState(1)
  const [addingMissing, setAddingMissing] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const showToast = useToast()

  function closePicker() {
    setPickerKey(null)
    setPendingRecipe(null)
  }

  useClickOutside(pickerRef, pickerKey !== null, closePicker)

  const recipeById = new Map(recipes.map((r) => [r.id, r]))

  const loadPlan = useCallback(async () => {
    setPlanItems(await getMealPlanRange(startKey, endKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, endKey])

  const loadRecipes = useCallback(async () => {
    const { data } = await supabase.from('recipes').select('id, title, portions').order('title', { ascending: true })
    setRecipes(data ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadPlan(), loadRecipes()]).then(() => setLoading(false))
  }, [loadPlan, loadRecipes])

  useRealtimeRefresh([{ table: 'meal_plan_items' }], loadPlan)
  useRealtimeRefresh([{ table: 'recipes' }], loadRecipes)

  function selectRecipe(recipe: RecipeOption) {
    setPendingRecipe(recipe)
    setPendingPortions(recipe.portions ?? 1)
  }

  async function handleAdd(dayKey: string, recipeId: string, portions: number | null) {
    setPickerKey(null)
    setPickerSearch('')
    setPendingRecipe(null)
    await addMealPlanItem(dayKey, recipeId, portions)
    void loadPlan()
  }

  async function handleRemove(item: MealPlanItem) {
    setPlanItems((current) => current.filter((i) => i.id !== item.id))
    await removeMealPlanItem(item.id)
    showToast('Aus dem Plan entfernt', {
      label: 'Rückgängig',
      onAction: async () => {
        await addMealPlanItem(item.plan_date, item.recipe_id, item.portions)
        void loadPlan()
      },
    })
  }

  async function handleAddMissingForWeek() {
    if (planItems.length === 0) {
      showToast('Für diese Woche ist noch nichts geplant')
      return
    }
    setAddingMissing(true)

    const uniqueRecipeIds = [...new Set(planItems.map((item) => item.recipe_id))]
    const { data: ingredientRows } = await supabase
      .from('recipe_ingredients')
      .select('*')
      .in('recipe_id', uniqueRecipeIds)
    const { data: foodItems } = await supabase.from('food_items').select('*')

    const ingredientsByRecipe = new Map<string, RecipeIngredient[]>()
    for (const ingredient of ingredientRows ?? []) {
      const list = ingredientsByRecipe.get(ingredient.recipe_id) ?? []
      list.push(ingredient)
      ingredientsByRecipe.set(ingredient.recipe_id, list)
    }

    // One "occurrence" per planned day, not per unique recipe, so a recipe
    // planned twice this week counts its ingredients twice. Each occurrence
    // scales by its own planned portions vs. the recipe's default portions,
    // same as cooking a single recipe for a different number of people.
    const occurrences = planItems.map((item) => {
      const recipe = recipeById.get(item.recipe_id)
      const ratio = recipe?.portions && item.portions ? item.portions / recipe.portions : 1
      return { ingredients: ingredientsByRecipe.get(item.recipe_id) ?? [], ratio }
    })
    const combined = aggregateIngredients(occurrences)
    const missing = getMissingIngredients(combined, foodItems ?? [])

    if (missing.length === 0) {
      setAddingMissing(false)
      showToast('Alle Zutaten für die Woche bereits vorhanden')
      return
    }
    await addMissingIngredientsToShoppingList(missing)
    setAddingMissing(false)
    showToast(`${missing.length} Zutaten zur Einkaufsliste hinzugefügt`)
  }

  const filteredRecipes = recipes.filter((r) => r.title.toLowerCase().includes(pickerSearch.trim().toLowerCase()))

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackLink to="/recipes" />
          <h1 className="text-xl font-semibold">Wochenplan</h1>
        </div>
        <button
          type="button"
          onClick={handleAddMissingForWeek}
          disabled={addingMissing || planItems.length === 0}
          className="shrink-0 rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {addingMissing ? 'Prüft...' : 'Fehlendes zur Liste'}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Lädt...</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {days.map((day) => {
            const dayKey = formatDateKey(day)
            const itemsForDay = planItems.filter((item) => item.plan_date === dayKey)
            return (
              <li key={dayKey} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">{formatDayLabel(day)}</h2>
                  <div ref={pickerKey === dayKey ? pickerRef : undefined} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerKey((current) => (current === dayKey ? null : dayKey))
                        setPickerSearch('')
                        setPendingRecipe(null)
                      }}
                      className="text-xs font-medium text-blue-600"
                    >
                      + Rezept
                    </button>
                    {pickerKey === dayKey && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                        {pendingRecipe ? (
                          <div>
                            <p className="truncate text-sm font-medium text-gray-900">{pendingRecipe.title}</p>
                            <div className="mt-2 flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => setPendingPortions((current) => Math.max(1, current - 1))}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-700"
                                aria-label="Weniger Portionen"
                              >
                                −
                              </button>
                              <span className="w-6 text-center text-sm font-medium text-gray-900">
                                {pendingPortions}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPendingPortions((current) => current + 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-700"
                                aria-label="Mehr Portionen"
                              >
                                +
                              </button>
                              <span className="text-xs text-gray-500">Portionen</span>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => setPendingRecipe(null)}
                                className="flex-1 rounded-md bg-gray-100 py-1.5 text-xs font-medium text-gray-600"
                              >
                                Zurück
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdd(dayKey, pendingRecipe.id, pendingPortions)}
                                className="flex-1 rounded-md bg-black py-1.5 text-xs font-semibold text-white"
                              >
                                Hinzufügen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <input
                              autoFocus
                              type="search"
                              value={pickerSearch}
                              onChange={(e) => setPickerSearch(e.target.value)}
                              placeholder="Rezept suchen..."
                              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                            />
                            <ul className="mt-2 max-h-48 overflow-y-auto">
                              {filteredRecipes.length === 0 && (
                                <li className="px-1 py-1 text-xs text-gray-400">Keine Rezepte gefunden.</li>
                              )}
                              {filteredRecipes.map((recipe) => (
                                <li key={recipe.id}>
                                  <button
                                    type="button"
                                    onClick={() => selectRecipe(recipe)}
                                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    {recipe.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {itemsForDay.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {itemsForDay.map((item) => {
                      const recipe = recipeById.get(item.recipe_id)
                      return (
                        <li key={item.id} className="flex items-center justify-between gap-2">
                          {recipe ? (
                            <Link to={`/recipes/${recipe.id}`} className="min-w-0 truncate text-sm text-gray-900">
                              {recipe.title}
                              {item.portions && <span className="text-gray-400"> · {item.portions} Portionen</span>}
                            </Link>
                          ) : (
                            <span className="min-w-0 truncate text-sm text-gray-400">Rezept gelöscht</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemove(item)}
                            className="shrink-0 text-xs font-medium text-gray-400"
                            aria-label="Aus Plan entfernen"
                          >
                            ×
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
