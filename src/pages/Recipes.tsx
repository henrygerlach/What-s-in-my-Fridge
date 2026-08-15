import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getMissingIngredients } from '../lib/stock'
import { addMissingIngredientsToShoppingList } from '../lib/shoppingList'
import { loadRecipesWithAvailability } from '../lib/recipeAvailability'
import type { RecipeWithAvailability } from '../lib/recipeAvailability'
import { useClickOutside } from '../lib/useClickOutside'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { useToast } from '../lib/ToastContext'
import { groupByCategory } from '../lib/groupByCategory'
import { RECIPE_CATEGORY_OPTIONS, RECIPE_CATEGORY_ICONS, UNCATEGORIZED_ICON, TAG_GROUPS } from '../lib/constants'
import { loadLastCookedMap } from '../lib/cookLog'
import { formatRelativeTime } from '../lib/relativeTime'

function availabilityColorClass(available: number, total: number): string {
  if (total === 0 || available === total) return 'text-green-600'
  if (available > 0) return 'text-orange-500'
  return 'text-red-500'
}

export default function Recipes() {
  const [recipes, setRecipes] = useState<RecipeWithAvailability[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null)
  const rowMenuRef = useRef<HTMLDivElement | null>(null)
  const [lastCooked, setLastCooked] = useState<Map<string, string>>(new Map())
  const showToast = useToast()

  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false))
  useClickOutside(rowMenuRef, openRowMenuId !== null, () => setOpenRowMenuId(null))

  const allTags = [...new Set(recipes.flatMap((recipe) => recipe.tags ?? []))].sort()

  const searchTerm = search.trim().toLowerCase()
  const visibleRecipes = recipes.filter(
    (recipe) =>
      (searchTerm === '' || recipe.title.toLowerCase().includes(searchTerm)) &&
      selectedTags.every((tag) => (recipe.tags ?? []).includes(tag)),
  )
  const groups = groupByCategory(visibleRecipes, (recipe) => recipe.category, RECIPE_CATEGORY_OPTIONS)

  // Mirrors RecipeForm's toggleTag: within a multi: false group (Art,
  // Zubereitungszeit) picking a tag replaces any other tag already selected
  // from that same group, so e.g. "Vegan" and "Vegetarisch" can't both be
  // active as filters at once.
  function toggleTag(tag: string) {
    const group = TAG_GROUPS.find((g) => g.options.includes(tag))
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((t) => t !== tag)
      if (!group || group.multi) return [...current, tag]
      return [...current.filter((t) => !group.options.includes(t)), tag]
    })
  }

  const loadRecipes = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    setRecipes(await loadRecipesWithAvailability())
    if (!options.silent) setLoading(false)
  }, [])

  const loadLastCooked = useCallback(async () => {
    setLastCooked(await loadLastCookedMap())
  }, [])

  useEffect(() => {
    Promise.all([loadRecipes(), loadLastCooked()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecipes])

  // Recipes/ingredients edited on another device, or food items consumed
  // elsewhere, should update the availability counts here live.
  useRealtimeRefresh(
    [{ table: 'recipes' }, { table: 'recipe_ingredients' }, { table: 'food_items' }],
    useCallback(() => void loadRecipes({ silent: true }), [loadRecipes]),
  )
  useRealtimeRefresh([{ table: 'recipe_cook_log' }], loadLastCooked)

  async function handleAddMissingToShoppingList(recipe: RecipeWithAvailability) {
    setOpenRowMenuId(null)
    const [{ data: ingredientRows }, { data: foodItems }] = await Promise.all([
      supabase.from('recipe_ingredients').select('*').eq('recipe_id', recipe.id),
      supabase.from('food_items').select('*'),
    ])

    const missing = getMissingIngredients(ingredientRows ?? [], foodItems ?? [])
    if (missing.length === 0) {
      showToast('Alle Zutaten bereits vorhanden')
      return
    }
    await addMissingIngredientsToShoppingList(missing)
    showToast(`${missing.length} Zutaten zur Einkaufsliste hinzugefügt`)
  }

  async function handleDeleteRecipe(recipe: RecipeWithAvailability) {
    const { data: snapshotIngredients } = await supabase
      .from('recipe_ingredients')
      .select('*')
      .eq('recipe_id', recipe.id)

    setOpenRowMenuId(null)
    setRecipes((current) => current.filter((r) => r.id !== recipe.id))
    await supabase.from('recipes').delete().eq('id', recipe.id)

    showToast(`${recipe.title} gelöscht`, {
      label: 'Rückgängig',
      onAction: async () => {
        const { id: _id, created_at: _createdAt, total: _total, available: _available, ...rest } = recipe
        const { data: restored } = await supabase.from('recipes').insert(rest).select().single()
        if (!restored) return

        if (snapshotIngredients && snapshotIngredients.length > 0) {
          await supabase.from('recipe_ingredients').insert(
            snapshotIngredients.map(({ id: _ingredientId, recipe_id: _oldRecipeId, ...ingredientRest }) => ({
              ...ingredientRest,
              recipe_id: restored.id,
            })),
          )
        }
        void loadRecipes()
      },
    })
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Rezepte</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/plan"
            aria-label="Essensplan"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-lg"
          >
            📅
          </Link>
          <div ref={menuOpen ? menuRef : undefined} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-lg font-semibold text-white"
            >
              +
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                <Link
                  to="/recipes/new"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Rezept erstellen
                </Link>
                <Link
                  to="/recipes/suggest"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  KI-Vorschlag
                </Link>
                <Link
                  to="/recipes/import"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Screenshot importieren
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Suchen..."
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      {allTags.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${
                selectedTags.includes(tag) ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Lädt...</p>
      ) : visibleRecipes.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">Keine Rezepte gefunden.</p>
      ) : (
        groups.map(([categoryLabel, groupRecipes]) => (
          <div key={categoryLabel} className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {RECIPE_CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON} {categoryLabel}
            </h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {groupRecipes.map((recipe) => (
                <li key={recipe.id} className="relative flex items-center justify-between gap-2 py-3">
                  <Link to={`/recipes/${recipe.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-gray-900">{recipe.title}</span>
                    <span className="block text-xs text-gray-400">
                      🕒{' '}
                      {lastCooked.has(recipe.id)
                        ? `Zuletzt gekocht ${formatRelativeTime(lastCooked.get(recipe.id)!)}`
                        : 'Noch nie gekocht'}
                    </span>
                    {recipe.kcal_per_portion != null && (
                      <span className="block text-xs text-gray-400">
                        🔥 {Math.round(recipe.kcal_per_portion)} kcal
                        {recipe.protein_g_per_portion != null &&
                          ` · ${Math.round(recipe.protein_g_per_portion)} g Eiweiß`}
                        {recipe.fat_g_per_portion != null && ` · ${Math.round(recipe.fat_g_per_portion)} g Fett`}
                        {recipe.carbs_g_per_portion != null && ` · ${Math.round(recipe.carbs_g_per_portion)} g KH`}
                        {' '}pro Portion
                      </span>
                    )}
                    {(recipe.tags ?? []).length > 0 && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {(recipe.tags ?? []).map((tag) => (
                          <span key={tag} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`whitespace-nowrap text-sm font-medium ${availabilityColorClass(recipe.available, recipe.total)}`}
                    >
                      {recipe.available}/{recipe.total} Zutaten vorhanden
                    </span>
                    <div ref={openRowMenuId === recipe.id ? rowMenuRef : undefined} className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenRowMenuId((current) => (current === recipe.id ? null : recipe.id))}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                        aria-label="Optionen"
                      >
                        ⋮
                      </button>
                      {openRowMenuId === recipe.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                          <Link
                            to={`/recipes/${recipe.id}/edit`}
                            onClick={() => setOpenRowMenuId(null)}
                            className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            Bearbeiten
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleAddMissingToShoppingList(recipe)}
                            className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                          >
                            Fehlende zur Einkaufsliste
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecipe(recipe)}
                            className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
                          >
                            Löschen
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
