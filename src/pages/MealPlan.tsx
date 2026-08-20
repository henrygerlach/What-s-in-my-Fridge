import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { useClickOutside } from '../lib/useClickOutside'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { getMissingIngredients } from '../lib/stock'
import { addMissingIngredientsToShoppingList } from '../lib/shoppingList'
import PageHeader from '../components/PageHeader'
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
    <div className="page">
      <PageHeader title="Wochenplan" back="/recipes">
        <button
          type="button"
          onClick={handleAddMissingForWeek}
          disabled={addingMissing || planItems.length === 0}
          className="btn btn-primary btn-sm"
        >
          {addingMissing ? 'Prüft...' : 'Fehlendes zur Liste'}
        </button>
      </PageHeader>

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Lädt...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {days.map((day) => {
            const dayKey = formatDateKey(day)
            const itemsForDay = planItems.filter((item) => item.plan_date === dayKey)
            return (
              <li key={dayKey} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="shelf-label flex-1">{formatDayLabel(day)}</h2>
                  <div ref={pickerKey === dayKey ? pickerRef : undefined} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerKey((current) => (current === dayKey ? null : dayKey))
                        setPickerSearch('')
                        setPendingRecipe(null)
                      }}
                      aria-expanded={pickerKey === dayKey}
                      className="btn btn-outline btn-sm min-h-9"
                    >
                      + Rezept
                    </button>
                    {pickerKey === dayKey && (
                      <div className="popover w-64">
                        {pendingRecipe ? (
                          <div>
                            <p className="truncate px-1 text-sm font-medium text-ink">{pendingRecipe.title}</p>
                            <div className="mt-2 flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => setPendingPortions((current) => Math.max(1, current - 1))}
                                className="btn-icon h-10 w-10 border border-rule bg-surface text-ink"
                                aria-label="Weniger Portionen"
                              >
                                −
                              </button>
                              <span
                                className="w-8 text-center text-base font-semibold text-ink"
                                style={{ fontFamily: 'var(--font-mono)' }}
                              >
                                {pendingPortions}
                              </span>
                              <button
                                type="button"
                                onClick={() => setPendingPortions((current) => current + 1)}
                                className="btn-icon h-10 w-10 border border-rule bg-surface text-ink"
                                aria-label="Mehr Portionen"
                              >
                                +
                              </button>
                              <span className="text-xs text-ink-muted">Portionen</span>
                            </div>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => setPendingRecipe(null)}
                                className="btn btn-quiet btn-sm flex-1"
                              >
                                Zurück
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdd(dayKey, pendingRecipe.id, pendingPortions)}
                                className="btn btn-primary btn-sm flex-1"
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
                              placeholder="Rezept suchen"
                              aria-label="Rezept suchen"
                              className="field min-h-10"
                            />
                            <ul className="mt-1 max-h-56 overflow-y-auto">
                              {filteredRecipes.length === 0 && (
                                <li className="px-2 py-2 text-xs text-ink-faint">Keine Rezepte gefunden.</li>
                              )}
                              {filteredRecipes.map((recipe) => (
                                <li key={recipe.id}>
                                  <button
                                    type="button"
                                    onClick={() => selectRecipe(recipe)}
                                    className="menu-item w-full truncate text-left"
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

                {itemsForDay.length === 0 ? (
                  <p className="mt-1.5 text-sm text-ink-faint">Nichts geplant</p>
                ) : (
                  <ul className="mt-1.5 divide-y divide-rule">
                    {itemsForDay.map((item) => {
                      const recipe = recipeById.get(item.recipe_id)
                      return (
                        <li key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                          {recipe ? (
                            <Link to={`/recipes/${recipe.id}`} className="min-w-0 flex-1 truncate text-sm text-ink">
                              {recipe.title}
                              {item.portions && (
                                <span className="measure ml-1.5">{item.portions} Portionen</span>
                              )}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-sm text-ink-faint">Rezept gelöscht</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemove(item)}
                            className="btn-icon h-9 w-8 text-lg text-ink-faint hover:text-danger"
                            aria-label="Aus dem Plan entfernen"
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
