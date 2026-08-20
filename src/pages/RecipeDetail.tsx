import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useClickOutside } from '../lib/useClickOutside'
import PageHeader from '../components/PageHeader'
import AvailabilityMeter from '../components/AvailabilityMeter'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const showToast = useToast()

  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false))

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

  if (loading) return <div className="page text-sm text-ink-faint">Lädt...</div>
  if (!recipe) return <div className="page text-sm text-ink-faint">Rezept nicht gefunden.</div>

  const availableCount = displayIngredients.filter((ingredient) =>
    isIngredientAvailable(ingredient, foodItems),
  ).length

  return (
    <div className="page">
      <PageHeader title={recipe.title} back="/recipes">
        <div ref={menuOpen ? menuRef : undefined} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="btn-icon border border-rule bg-surface text-ink-muted"
            aria-label="Optionen"
            aria-expanded={menuOpen}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="popover w-44 p-1">
              <Link to={`/recipes/${recipe.id}/edit`} className="menu-item">
                Bearbeiten
              </Link>
              <button type="button" onClick={handleDelete} className="menu-item w-full text-left text-danger">
                Löschen
              </button>
            </div>
          )}
        </div>
      </PageHeader>

      {recipe.photo_url && (
        <img src={recipe.photo_url} alt="" className="mb-3 aspect-[16/10] w-full rounded-xl object-cover" />
      )}

      {(recipe.category || (recipe.tags ?? []).length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {recipe.category && <span className="tag border-ink/20 bg-ink/5 text-ink">{recipe.category}</span>}
          {(recipe.tags ?? []).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Cooking for a different number of people is the one thing that
          rewrites this whole page, so it sits above everything it changes. */}
      <div className="card mt-3 flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="shelf-label">Ich koche für</p>
          <p className="mt-1 truncate text-xs text-ink-muted">
            {recipe.portions ? `Rezept für ${recipe.portions} Portionen` : 'Portionen im Rezept nicht angegeben'}
            {scaling && <span className="ml-1 text-ink-faint">· wird angepasst...</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => adjustPortions(-1)}
            disabled={scaling}
            className="btn-icon h-10 w-10 border border-rule bg-surface text-ink"
            aria-label="Weniger Portionen"
          >
            −
          </button>
          <span
            className="w-8 text-center text-lg font-semibold text-ink"
            style={{ fontFamily: 'var(--font-mono)' }}
            aria-live="polite"
          >
            {cookPortions ?? '–'}
          </span>
          <button
            type="button"
            onClick={() => adjustPortions(1)}
            disabled={scaling}
            className="btn-icon h-10 w-10 border border-rule bg-surface text-ink"
            aria-label="Mehr Portionen"
          >
            +
          </button>
        </div>
      </div>

      {recipe.kcal_per_portion != null ? (
        <p className="measure mt-2">
          {Math.round(recipe.kcal_per_portion)} kcal
          {recipe.protein_g_per_portion != null && ` · ${Math.round(recipe.protein_g_per_portion)} g Eiweiß`}
          {recipe.fat_g_per_portion != null && ` · ${Math.round(recipe.fat_g_per_portion)} g Fett`}
          {recipe.carbs_g_per_portion != null && ` · ${Math.round(recipe.carbs_g_per_portion)} g KH`}
          <span className="ml-1.5 font-sans text-xs text-ink-faint">pro Portion, geschätzt</span>
        </p>
      ) : (
        ingredients.length > 0 && (
          <button
            type="button"
            onClick={handleEstimateNutrition}
            disabled={estimatingNutrition}
            className="btn btn-sm mt-1 px-0 text-ink-muted underline underline-offset-4"
          >
            {estimatingNutrition ? 'Schätzt Nährwerte...' : 'Nährwerte schätzen'}
          </button>
        )
      )}

      <div className="mt-5 flex items-end justify-between gap-3">
        <h2 className="shelf-label flex-1">Zutaten</h2>
        <AvailabilityMeter available={availableCount} total={displayIngredients.length} />
      </div>
      <ul className="mt-2 divide-y divide-rule">
        {displayIngredients.map((ingredient) => {
          const available = isIngredientAvailable(ingredient, foodItems)
          const onShoppingList = !available && isIngredientAvailable(ingredient, shoppingList)
          return (
            <li key={ingredient.id} className="flex items-center justify-between gap-2 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                {/* Same mark as one segment of the availability meter above. */}
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-xs ${available ? 'bg-full' : 'border border-rule bg-shelf'}`}
                />
                <span className={`min-w-0 truncate text-sm ${available ? 'text-ink' : 'text-ink-faint'}`}>
                  {ingredient.name}
                </span>
                {ingredient.quantity != null && (
                  <span className="measure shrink-0">
                    {ingredient.quantity}
                    {ingredient.unit ? ` ${ingredient.unit}` : ''}
                  </span>
                )}
              </span>
              {!available && (
                <span className="flex shrink-0 items-center gap-2">
                  {onShoppingList ? (
                    <span className="text-xs text-ink-faint">schon auf der Liste</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddMissing(ingredient)}
                      className="btn btn-outline btn-sm"
                    >
                      + Liste
                    </button>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {availableCount < displayIngredients.length && (
        <button type="button" onClick={handleAddAllMissing} className="btn btn-quiet btn-sm mt-2 w-full">
          Alle fehlenden zur Einkaufsliste
        </button>
      )}

      <h2 className="shelf-label mt-6">Zubereitung</h2>
      {/* Steps are a real sequence — the numbers carry order the cook needs,
          and the text is set larger than the rest of the app because it is
          read at arm's length from a worktop. */}
      <ol className="mt-3 flex flex-col gap-4">
        {splitInstructionSteps(displayInstructions).map((step, index) => (
          <li key={index} className="flex gap-3">
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap text-base leading-relaxed text-ink">
              {step.replace(/^\d+\.\s*/, '')}
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={handleCookRecipe}
        disabled={!allAvailable}
        className="btn btn-primary mt-8 w-full"
      >
        Gekocht – Zutaten vom Bestand abziehen
      </button>
      {!allAvailable && (
        <p className="mt-2 text-center text-xs text-ink-faint">
          Erst abziehbar, wenn alle Zutaten im Inventar sind.
        </p>
      )}
    </div>
  )
}
