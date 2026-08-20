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
import PageHeader from '../components/PageHeader'
import AvailabilityMeter from '../components/AvailabilityMeter'
import { formatRelativeTime } from '../lib/relativeTime'

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
  const tagGroups = TAG_GROUPS.map((group) => ({
    label: group.label,
    tags: group.options.filter((tag) => allTags.includes(tag)),
  })).filter((group) => group.tags.length > 0)
  const otherTags = allTags.filter((tag) => !TAG_GROUPS.some((group) => group.options.includes(tag)))
  if (otherTags.length > 0) tagGroups.push({ label: 'Sonstiges', tags: otherTags })

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
    <div className="page">
      <PageHeader title="Rezepte">
        <Link to="/plan" aria-label="Wochenplan" className="btn-icon border border-rule bg-surface text-ink">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7}
               strokeLinecap="round" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2.5" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </Link>
        <div ref={menuOpen ? menuRef : undefined} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="Rezept hinzufügen"
            aria-expanded={menuOpen}
            className="btn-icon bg-ink font-semibold text-white"
          >
            +
          </button>
          {menuOpen && (
            <div className="popover w-56 p-1">
              <Link to="/recipes/new" onClick={() => setMenuOpen(false)} className="menu-item">
                Rezept erstellen
              </Link>
              <Link to="/recipes/suggest" onClick={() => setMenuOpen(false)} className="menu-item">
                KI-Vorschlag
              </Link>
              <Link to="/recipes/import" onClick={() => setMenuOpen(false)} className="menu-item">
                Screenshot importieren
              </Link>
            </div>
          )}
        </div>
      </PageHeader>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rezept suchen"
        aria-label="Rezept suchen"
        className="field"
      />

      {tagGroups.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          {tagGroups.map((group) => (
            <div key={group.label}>
              <p className="shelf-label">{group.label}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {group.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={selectedTags.includes(tag)}
                    className={`chip ${selectedTags.includes(tag) ? 'chip-on' : ''}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Lädt...</p>
      ) : visibleRecipes.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-ink-muted">
            {recipes.length === 0 ? 'Noch keine Rezepte gespeichert.' : 'Keine Rezepte gefunden.'}
          </p>
          {recipes.length === 0 && (
            <Link to="/recipes/new" className="btn btn-primary mt-3">
              Erstes Rezept anlegen
            </Link>
          )}
        </div>
      ) : (
        groups.map(([categoryLabel, groupRecipes]) => (
          <div key={categoryLabel} className="mt-5">
            <h2 className="shelf-label">
              <span aria-hidden>{RECIPE_CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON}</span>
              {categoryLabel}
            </h2>
            <ul className="mt-1 divide-y divide-rule">
              {groupRecipes.map((recipe) => (
                <li key={recipe.id} className="relative flex items-start justify-between gap-2 py-3">
                  <Link to={`/recipes/${recipe.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{recipe.title}</span>
                    <span className="measure mt-0.5 block truncate">
                      {lastCooked.has(recipe.id)
                        ? `Zuletzt gekocht ${formatRelativeTime(lastCooked.get(recipe.id)!)}`
                        : 'Noch nie gekocht'}
                    </span>
                    {/* Headline figures only — the full macro split is on the
                        recipe itself, and spelling it out here only ever
                        truncated mid-word. */}
                    {recipe.kcal_per_portion != null && (
                      <span className="measure mt-0.5 block truncate">
                        {Math.round(recipe.kcal_per_portion)} kcal
                        {recipe.protein_g_per_portion != null &&
                          ` · ${Math.round(recipe.protein_g_per_portion)} g Eiweiß`}
                        <span className="ml-1.5 font-sans">pro Portion</span>
                      </span>
                    )}
                    {(recipe.tags ?? []).length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {(recipe.tags ?? []).map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-start gap-1">
                    <AvailabilityMeter available={recipe.available} total={recipe.total} className="pt-0.5" />
                    <div ref={openRowMenuId === recipe.id ? rowMenuRef : undefined} className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenRowMenuId((current) => (current === recipe.id ? null : recipe.id))}
                        className="btn-icon h-9 w-8 text-ink-muted hover:text-ink"
                        aria-label="Optionen"
                        aria-expanded={openRowMenuId === recipe.id}
                      >
                        ⋮
                      </button>
                      {openRowMenuId === recipe.id && (
                        <div className="popover w-52 p-1">
                          <Link
                            to={`/recipes/${recipe.id}/edit`}
                            onClick={() => setOpenRowMenuId(null)}
                            className="menu-item"
                          >
                            Bearbeiten
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleAddMissingToShoppingList(recipe)}
                            className="menu-item w-full text-left"
                          >
                            Fehlende zur Einkaufsliste
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecipe(recipe)}
                            className="menu-item w-full text-left text-danger"
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
