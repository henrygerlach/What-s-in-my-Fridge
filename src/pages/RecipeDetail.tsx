import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { computeStockDeductions, getMissingIngredients, isIngredientAvailable } from '../lib/stock'
import { addMissingIngredientsToShoppingList, getShoppingList } from '../lib/shoppingList'
import type { ShoppingListItem } from '../lib/shoppingList'
import { useToast } from '../lib/ToastContext'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { splitInstructionSteps } from '../lib/instructions'
import { logCookedRecipe } from '../lib/cookLog'
import { logConsumption } from '../lib/consumptionLog'
import { estimateNutrition } from '../lib/nutrition'
import BackLink from '../components/BackLink'
import type { FoodItem, Recipe, RecipeIngredient } from '../types'

export default function RecipeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([])
  const [foodItems, setFoodItems] = useState<FoodItem[]>([])
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([])
  const [loading, setLoading] = useState(true)
  // Portions to cook right now — a local, view-only scale factor. The
  // recipe's own portions/ingredients/instructions are fixed at creation and
  // never touched by this; nothing here is persisted.
  const [cookPortions, setCookPortions] = useState<number | null>(null)
  const [displayInstructions, setDisplayInstructions] = useState('')
  const [scaling, setScaling] = useState(false)
  const [estimatingNutrition, setEstimatingNutrition] = useState(false)
  const showToast = useToast()

  // Reloading the recipe itself (e.g. edited on another device) must not
  // reset `cookPortions` once the user has already opened this page —
  // that's a local, view-only scale factor they may be mid-adjusting.
  const loadRecipeAndIngredients = useCallback(
    async (options: { isFirstLoad?: boolean } = {}) => {
      if (!id) return
      const [{ data: recipeRow }, { data: ingredientRows }] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase.from('recipe_ingredients').select('*').eq('recipe_id', id),
      ])
      setRecipe(recipeRow ?? null)
      setIngredients(ingredientRows ?? [])
      if (options.isFirstLoad) {
        setCookPortions(recipeRow?.portions ?? null)
        setDisplayInstructions(recipeRow?.instructions ?? '')
      }
    },
    [id],
  )

  const loadFoodItems = useCallback(async () => {
    const { data } = await supabase.from('food_items').select('*')
    setFoodItems(data ?? [])
  }, [])

  const loadShoppingListItems = useCallback(async () => {
    setShoppingList(await getShoppingList())
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false

    Promise.all([loadRecipeAndIngredients({ isFirstLoad: true }), loadFoodItems(), loadShoppingListItems()]).then(
      () => {
        if (!cancelled) setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [id, loadRecipeAndIngredients, loadFoodItems, loadShoppingListItems])

  // Live-sync with other devices: ingredient availability changes whenever
  // anyone consumes/adds stock, and the recipe itself may be edited or the
  // shopping list updated while this page is open.
  useRealtimeRefresh(
    id ? [{ table: 'recipes', filter: `id=eq.${id}` }, { table: 'recipe_ingredients', filter: `recipe_id=eq.${id}` }] : [],
    useCallback(() => void loadRecipeAndIngredients(), [loadRecipeAndIngredients]),
  )
  useRealtimeRefresh([{ table: 'food_items' }], loadFoodItems)
  useRealtimeRefresh([{ table: 'shopping_list_items' }], loadShoppingListItems)

  // Rewrite the instructions text for display only when cooking a different
  // amount than the recipe is written for. Always scales from the recipe's
  // original instructions (never from a previously-scaled version), and never
  // writes the result back to the recipe.
  useEffect(() => {
    if (!recipe || cookPortions === null) return

    if (!recipe.portions || cookPortions === recipe.portions || !recipe.instructions.trim()) {
      setDisplayInstructions(recipe.instructions)
      return
    }

    const timeoutId = window.setTimeout(async () => {
      setScaling(true)
      const { data, error } = await supabase.functions.invoke('scale-recipe', {
        body: { instructions: recipe.instructions, originalPortions: recipe.portions, newPortions: cookPortions },
      })
      setScaling(false)
      setDisplayInstructions(!error && data?.instructions ? data.instructions : recipe.instructions)
    }, 700)

    return () => window.clearTimeout(timeoutId)
  }, [cookPortions, recipe])

  function adjustPortions(delta: number) {
    setCookPortions((current) => {
      const base = current ?? recipe?.portions ?? 1
      return Math.max(1, base + delta)
    })
  }

  const ratio = recipe?.portions && cookPortions ? cookPortions / recipe.portions : 1
  const displayIngredients = ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: ingredient.quantity != null ? Math.round(ingredient.quantity * ratio * 100) / 100 : null,
  }))
  const allAvailable =
    displayIngredients.length > 0 &&
    displayIngredients.every((ingredient) => isIngredientAvailable(ingredient, foodItems))

  async function handleAddMissing(ingredient: RecipeIngredient) {
    await addMissingIngredientsToShoppingList([ingredient])
    setShoppingList(await getShoppingList())
    showToast(`${ingredient.name} zur Einkaufsliste hinzugefügt`)
  }

  async function handleAddAllMissing() {
    const missing = getMissingIngredients(displayIngredients, foodItems)
    if (missing.length === 0) {
      showToast('Alle Zutaten bereits vorhanden')
      return
    }
    await addMissingIngredientsToShoppingList(missing)
    setShoppingList(await getShoppingList())
    showToast(`${missing.length} Zutaten zur Einkaufsliste hinzugefügt`)
  }

  async function handleCookRecipe() {
    if (!recipe || !allAvailable) return

    void logCookedRecipe(recipe.id)

    const updates = computeStockDeductions(displayIngredients, foodItems)
    if (updates.length === 0) {
      showToast('Kein Abzug notwendig')
      return
    }

    const originalById = new Map(foodItems.map((item) => [item.id, item]))
    const toDelete = updates.filter((update) => update.quantity <= 0)
    const toUpdate = updates.filter((update) => update.quantity > 0)

    for (const update of updates) {
      const original = originalById.get(update.id)
      if (!original) continue
      const removed = (original.quantity ?? 0) - Math.max(update.quantity, 0)
      void logConsumption(original, 'consumed', { quantity: removed, source: 'cooked', recipeTitle: recipe.title })
    }

    await Promise.all([
      ...toDelete.map((update) => supabase.from('food_items').delete().eq('id', update.id)),
      ...toUpdate.map((update) => supabase.from('food_items').update({ quantity: update.quantity }).eq('id', update.id)),
    ])

    setFoodItems((current) =>
      current
        .filter((item) => !toDelete.some((update) => update.id === item.id))
        .map((item) => {
          const update = toUpdate.find((u) => u.id === item.id)
          return update ? { ...item, quantity: update.quantity } : item
        }),
    )

    showToast(`${recipe.title} gekocht – Zutaten vom Bestand abgezogen`, {
      label: 'Rückgängig',
      onAction: async () => {
        await Promise.all(
          updates.map((update) => {
            const original = originalById.get(update.id)
            if (!original) return Promise.resolve()
            if (update.quantity <= 0) {
              const { id: _originalId, ...rest } = original
              return supabase.from('food_items').insert(rest)
            }
            return supabase.from('food_items').update({ quantity: original.quantity }).eq('id', update.id)
          }),
        )
        const { data: items } = await supabase.from('food_items').select('*')
        setFoodItems(items ?? [])
      },
    })
  }

  async function handleEstimateNutrition() {
    if (!recipe || ingredients.length === 0) return
    setEstimatingNutrition(true)
    const estimate = await estimateNutrition(recipe.title, ingredients, recipe.portions ?? 1)
    setEstimatingNutrition(false)

    if (!estimate) {
      showToast('Nährwerte konnten nicht geschätzt werden')
      return
    }

    const patch = {
      kcal_per_portion: estimate.kcal,
      protein_g_per_portion: estimate.protein_g,
      fat_g_per_portion: estimate.fat_g,
      carbs_g_per_portion: estimate.carbs_g,
    }
    await supabase.from('recipes').update(patch).eq('id', recipe.id)
    setRecipe((current) => (current ? { ...current, ...patch } : current))
  }

  async function handleDelete() {
    if (!recipe) return
    const snapshotRecipe = recipe
    const snapshotIngredients = ingredients

    await supabase.from('recipes').delete().eq('id', recipe.id)
    navigate('/recipes')

    showToast(`${snapshotRecipe.title} gelöscht`, {
      label: 'Rückgängig',
      onAction: async () => {
        const { id: _id, created_at: _createdAt, ...rest } = snapshotRecipe
        const { data: restored } = await supabase.from('recipes').insert(rest).select().single()
        if (!restored) return

        if (snapshotIngredients.length > 0) {
          await supabase.from('recipe_ingredients').insert(
            snapshotIngredients.map(({ id: _ingredientId, recipe_id: _oldRecipeId, ...ingredientRest }) => ({
              ...ingredientRest,
              recipe_id: restored.id,
            })),
          )
        }
        navigate(`/recipes/${restored.id}`)
      },
    })
  }

  if (loading) return <div className="p-4 text-sm text-gray-500">Lädt...</div>
  if (!recipe) return <div className="p-4 text-sm text-gray-500">Rezept nicht gefunden.</div>

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BackLink to="/recipes" />
          <h1 className="min-w-0 truncate text-xl font-semibold">{recipe.title}</h1>
          {recipe.category && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{recipe.category}</span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to={`/recipes/${recipe.id}/edit`}
            className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
          >
            Bearbeiten
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-red-600"
          >
            Löschen
          </button>
        </div>
      </div>
      {(recipe.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(recipe.tags ?? []).map((tag) => (
            <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      )}
      {recipe.photo_url && (
        <img src={recipe.photo_url} alt={recipe.title} className="mt-3 w-full rounded-lg object-cover" />
      )}

      <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
        <span>Ich koche für</span>
        <button
          type="button"
          onClick={() => adjustPortions(-1)}
          disabled={scaling}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-700 disabled:opacity-50"
          aria-label="Weniger Portionen"
        >
          −
        </button>
        <span className="w-6 text-center font-medium text-gray-900">{cookPortions ?? '–'}</span>
        <button
          type="button"
          onClick={() => adjustPortions(1)}
          disabled={scaling}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-700 disabled:opacity-50"
          aria-label="Mehr Portionen"
        >
          +
        </button>
        <span>Portionen{recipe.portions ? ` (Rezept für ${recipe.portions})` : ''}</span>
        {scaling && <span className="text-xs text-gray-400">wird angepasst...</span>}
      </div>

      {recipe.kcal_per_portion != null ? (
        <p className="mt-2 text-xs text-gray-500">
          🔥 {Math.round(recipe.kcal_per_portion)} kcal
          {recipe.protein_g_per_portion != null && ` · ${Math.round(recipe.protein_g_per_portion)} g Eiweiß`}
          {recipe.fat_g_per_portion != null && ` · ${Math.round(recipe.fat_g_per_portion)} g Fett`}
          {recipe.carbs_g_per_portion != null && ` · ${Math.round(recipe.carbs_g_per_portion)} g KH`}
          {' '}
          <span className="text-gray-400">(pro Portion, geschätzt)</span>
        </p>
      ) : (
        ingredients.length > 0 && (
          <button
            type="button"
            onClick={handleEstimateNutrition}
            disabled={estimatingNutrition}
            className="mt-2 text-xs font-medium text-blue-600 disabled:opacity-50"
          >
            {estimatingNutrition ? 'Schätzt Nährwerte...' : 'Nährwerte schätzen'}
          </button>
        )
      )}

      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Zutaten</h2>
        <button type="button" onClick={handleAddAllMissing} className="text-xs font-medium text-blue-600">
          Fehlende zur Einkaufsliste
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {displayIngredients.map((ingredient) => {
          const available = isIngredientAvailable(ingredient, foodItems)
          const onShoppingList = !available && isIngredientAvailable(ingredient, shoppingList)
          return (
            <li key={ingredient.id} className="flex items-center justify-between text-sm">
              <span className={available ? 'text-gray-900' : 'text-gray-400'}>
                {available ? '✓' : '✗'} {ingredient.name}
                {ingredient.quantity
                  ? ` (${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''})`
                  : ''}
              </span>
              {!available && (
                <div className="flex items-center gap-2">
                  {onShoppingList && <span className="text-xs text-gray-400">schon auf Liste</span>}
                  <button
                    type="button"
                    onClick={() => handleAddMissing(ingredient)}
                    className="text-xs font-medium text-blue-600"
                  >
                    Zur Liste
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <h2 className="mt-4 text-sm font-semibold text-gray-700">Zubereitung</h2>
      <ol className="mt-2 flex flex-col gap-2">
        {splitInstructionSteps(displayInstructions).map((step, index) => (
          <li key={index} className="flex gap-2 text-sm text-gray-700">
            <span className="text-gray-400">{index + 1}.</span>
            <span className="whitespace-pre-wrap">{step.replace(/^\d+\.\s*/, '')}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={handleCookRecipe}
        disabled={!allAvailable}
        className="mt-6 w-full rounded-lg bg-black py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Gekocht – Zutaten vom Bestand abziehen
      </button>
    </div>
  )
}
