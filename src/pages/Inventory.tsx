import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { useClickOutside } from '../lib/useClickOutside'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { groupByCategory } from '../lib/groupByCategory'
import {
  CATEGORY_OPTIONS,
  CATEGORY_ICONS,
  UNCATEGORIZED_ICON,
  LOCATION_LABELS,
  LOCATION_DOT_CLASS,
} from '../lib/constants'
import PageHeader from '../components/PageHeader'
import AvailabilityMeter from '../components/AvailabilityMeter'
import { loadRecipesWithAvailability } from '../lib/recipeAvailability'
import type { RecipeWithAvailability } from '../lib/recipeAvailability'
import { currentMealCategory, MEAL_CATEGORY_LABELS } from '../lib/mealTime'
import { addToShoppingList, getShoppingList } from '../lib/shoppingList'
import type { ShoppingListItem } from '../lib/shoppingList'
import { addStapleItem, getMissingStaples, getStapleItems, removeStapleItem } from '../lib/stapleItems'
import { isMatch } from '../lib/matching'
import { logConsumption } from '../lib/consumptionLog'
import type { FoodItem, Location, StapleItem } from '../types'

const filters: Array<{ value: Location | 'all'; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'fridge', label: LOCATION_LABELS.fridge },
  { value: 'pantry', label: LOCATION_LABELS.pantry },
  { value: 'freezer', label: LOCATION_LABELS.freezer },
]

const consumeFractions: Array<{ value: number; label: string }> = [
  { value: 0.25, label: '1/4' },
  { value: 0.5, label: '1/2' },
  { value: 0.75, label: '3/4' },
  { value: 1, label: 'Ganz' },
]

export default function Inventory() {
  const [items, setItems] = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Location | 'all'>('all')
  const [search, setSearch] = useState('')
  const [openMenuItemId, setOpenMenuItemId] = useState<string | null>(null)
  const [openMenuMode, setOpenMenuMode] = useState<'consume' | 'list'>('consume')
  const [customAmount, setCustomAmount] = useState('')
  const [listAmount, setListAmount] = useState('')
  const [topRecipes, setTopRecipes] = useState<RecipeWithAvailability[]>([])
  const [mealCategory] = useState(() => currentMealCategory())
  const [confirmingClearAll, setConfirmingClearAll] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [staples, setStaples] = useState<StapleItem[]>([])
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([])
  const showToast = useToast()
  const menuContainerRef = useRef<HTMLLIElement | null>(null)
  const clearAllMenuRef = useRef<HTMLDivElement | null>(null)

  useClickOutside(menuContainerRef, openMenuItemId !== null, () => setOpenMenuItemId(null))
  useClickOutside(clearAllMenuRef, confirmingClearAll, () => setConfirmingClearAll(false))

  const loadItems = useCallback(async () => {
    const { data } = await supabase.from('food_items').select('*').order('name', { ascending: true })
    setItems(data ?? [])
  }, [])

  // Only recipes matching the current meal (breakfast/lunch/dinner) are
  // shown — if none are cookable right now, the widget stays hidden rather
  // than suggesting something unrelated to the current mealtime.
  const loadTopRecipes = useCallback(async () => {
    const recipes = await loadRecipesWithAvailability()
    const matching = recipes.filter(
      (recipe) => recipe.total > 0 && recipe.available > 0 && recipe.category === mealCategory,
    )
    setTopRecipes(matching.slice(0, 3))
  }, [mealCategory])

  const loadStaples = useCallback(async () => {
    setStaples(await getStapleItems())
  }, [])

  const loadShoppingList = useCallback(async () => {
    setShoppingList(await getShoppingList())
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadItems(), loadTopRecipes(), loadStaples(), loadShoppingList()]).then(() => setLoading(false))
  }, [loadItems, loadTopRecipes, loadStaples, loadShoppingList])

  // Other devices can add/remove/consume items or edit recipes at the same
  // time, so re-fetch (without showing the loading state) whenever any of
  // that shared data changes on the server.
  useRealtimeRefresh(
    [{ table: 'food_items' }, { table: 'recipes' }, { table: 'recipe_ingredients' }],
    useCallback(() => {
      void loadItems()
      void loadTopRecipes()
    }, [loadItems, loadTopRecipes]),
  )
  useRealtimeRefresh([{ table: 'staple_items' }], loadStaples)
  useRealtimeRefresh([{ table: 'shopping_list_items' }], loadShoppingList)

  async function handleAddToShoppingList(item: FoodItem, amount: number | null) {
    await addToShoppingList(item.name, amount, item.unit, item.category || null)
    setOpenMenuItemId(null)
    setListAmount('')
    showToast(`${item.name} zur Einkaufsliste hinzugefügt`)
  }

  async function handleClearAll() {
    const snapshot = items
    setClearingAll(true)
    await supabase
      .from('food_items')
      .delete()
      .in('id', snapshot.map((item) => item.id))
    setClearingAll(false)
    setConfirmingClearAll(false)
    setItems([])

    showToast(
      `${snapshot.length} Artikel gelöscht`,
      {
        label: 'Rückgängig',
        onAction: async () => {
          const rows = snapshot.map(({ id: _id, created_at: _createdAt, ...rest }) => rest)
          const { data } = await supabase.from('food_items').insert(rows).select()
          if (data) setItems(data)
        },
      },
      15000,
    )
  }

  const searchTerm = search.trim().toLowerCase()
  const visibleItems = items.filter(
    (item) =>
      (filter === 'all' || item.location === filter) &&
      (searchTerm === '' || item.name.toLowerCase().includes(searchTerm)),
  )
  const groups = groupByCategory(visibleItems, (item) => item.category || null, CATEGORY_OPTIONS)
  const missingStaples = getMissingStaples(staples, items, shoppingList)

  async function handleFullRemoval(item: FoodItem, reason: 'consumed' | 'discarded' = 'consumed') {
    setItems((current) => current.filter((i) => i.id !== item.id))
    await supabase.from('food_items').delete().eq('id', item.id)
    void logConsumption(item, reason)

    showToast(reason === 'discarded' ? `${item.name} weggeworfen` : `${item.name} entfernt`, {
      label: 'Rückgängig',
      onAction: async () => {
        const { id: _id, created_at: _createdAt, ...rest } = item
        const { data } = await supabase.from('food_items').insert(rest).select().single()
        if (data) setItems((current) => [...current, data])
      },
    })
  }

  async function handleToggleStaple(item: FoodItem) {
    const existing = staples.find((staple) => isMatch(staple.name, item.name))
    if (existing) {
      setStaples((current) => current.filter((s) => s.id !== existing.id))
      await removeStapleItem(existing.id)
    } else {
      await addStapleItem(item.name)
      setStaples(await getStapleItems())
    }
  }

  async function handleAddStapleToShoppingList(staple: StapleItem) {
    await addToShoppingList(staple.name)
    setShoppingList(await getShoppingList())
    showToast(`${staple.name} zur Einkaufsliste hinzugefügt`)
  }

  async function handlePartialConsumption(item: FoodItem, remaining: number) {
    const original = item.quantity
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, quantity: remaining } : i)))
    await supabase.from('food_items').update({ quantity: remaining }).eq('id', item.id)
    void logConsumption(item, 'consumed', { quantity: (original ?? 0) - remaining })

    showToast(`${item.name}: Menge aktualisiert`, {
      label: 'Rückgängig',
      onAction: async () => {
        setItems((current) => current.map((i) => (i.id === item.id ? { ...i, quantity: original } : i)))
        await supabase.from('food_items').update({ quantity: original }).eq('id', item.id)
      },
    })
  }

  function applyConsumption(item: FoodItem, amountConsumed: number) {
    const remaining = Math.round(((item.quantity ?? 0) - amountConsumed) * 100) / 100
    if (remaining <= 0) {
      void handleFullRemoval(item)
    } else {
      void handlePartialConsumption(item, remaining)
    }
    setOpenMenuItemId(null)
    setCustomAmount('')
  }

  function toggleMenu(itemId: string, mode: 'consume' | 'list') {
    setOpenMenuItemId((current) => (current === itemId && openMenuMode === mode ? null : itemId))
    setOpenMenuMode(mode)
    setCustomAmount('')
    setListAmount('')
  }

  return (
    <div className="page">
      <PageHeader title="Inventar">
        <Link to="/waste" className="chip">
          Statistik
        </Link>
        {items.length > 0 && (
          <div ref={confirmingClearAll ? clearAllMenuRef : undefined} className="relative">
            <button type="button" onClick={() => setConfirmingClearAll((current) => !current)} className="chip">
              Leeren
            </button>
            {confirmingClearAll && (
              <div className="popover w-52">
                <p className="px-1 text-sm text-ink-muted">
                  <span className="measure text-ink">{items.length}</span> Artikel wirklich löschen?
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmingClearAll(false)} className="btn btn-quiet btn-sm flex-1">
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={clearingAll}
                    className="btn btn-danger btn-sm flex-1"
                  >
                    {clearingAll ? '...' : 'Löschen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <Link to="/add" aria-label="Artikel hinzufügen" className="btn-icon bg-ink font-semibold text-white">
          +
        </Link>
      </PageHeader>

      {missingStaples.length > 0 && (
        <div className="card mb-3 border-partial/40 bg-partial/5 p-3">
          <h2 className="shelf-label text-partial">Standardvorrat leer</h2>
          <ul className="mt-2 flex flex-col">
            {missingStaples.map((staple) => (
              <li key={staple.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{staple.name}</span>
                <button
                  type="button"
                  onClick={() => handleAddStapleToShoppingList(staple)}
                  className="btn btn-sm text-partial"
                >
                  + Liste
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The home screen's thesis: before anything else, the fridge answers
          what can be cooked from it right now. */}
      {topRecipes.length > 0 && (
        <section className="card mb-3 overflow-hidden border-t-4 border-t-ink">
          <h2 className="shelf-label px-3 pt-3">{MEAL_CATEGORY_LABELS[mealCategory] ?? 'Was koche ich heute?'}</h2>
          <ul className="mt-1 divide-y divide-rule">
            {topRecipes.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  to={`/recipes/${recipe.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-shelf"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{recipe.title}</span>
                  <AvailabilityMeter available={recipe.available} total={recipe.total} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Lebensmittel suchen"
        aria-label="Lebensmittel suchen"
        className="field"
      />

      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`chip ${filter === f.value ? 'chip-on' : ''}`}
          >
            {f.value !== 'all' && (
              <span className={`dot mr-1.5 ${filter === f.value ? 'bg-white' : LOCATION_DOT_CLASS[f.value]}`} />
            )}
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Lädt...</p>
      ) : visibleItems.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-ink-muted">
            {items.length === 0 ? 'Dein Inventar ist leer.' : 'Keine Lebensmittel gefunden.'}
          </p>
          {items.length === 0 && (
            <Link to="/add" className="btn btn-primary mt-3">
              Erstes Lebensmittel eintragen
            </Link>
          )}
        </div>
      ) : (
        groups.map(([categoryLabel, groupItems]) => (
          <div key={categoryLabel} className="mt-5">
            <h2 className="shelf-label">
              <span aria-hidden>{CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON}</span>
              {categoryLabel}
            </h2>
            <ul className="mt-1 divide-y divide-rule">
              {groupItems.map((item) => {
                const isStaple = staples.some((staple) => isMatch(staple.name, item.name))
                return (
                <li
                  key={item.id}
                  ref={openMenuItemId === item.id ? menuContainerRef : undefined}
                  className="relative flex items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{item.name}</p>
                    {/* Quantity first, location second: the dot already carries
                        the location, so it is the half that can be truncated
                        away on a narrow row without losing anything. */}
                    <p className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={`dot ${LOCATION_DOT_CLASS[item.location]}`}
                        title={LOCATION_LABELS[item.location]}
                        aria-hidden
                      />
                      <span className="measure truncate">
                        {item.quantity ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''} · ` : ''}
                        {LOCATION_LABELS[item.location]}
                      </span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleToggleStaple(item)}
                      className={`btn-icon h-10 w-8 text-base ${isStaple ? 'text-partial' : 'text-ink-faint'}`}
                      aria-label={isStaple ? 'Standardvorrat entfernen' : 'Als Standardvorrat markieren'}
                      aria-pressed={isStaple}
                    >
                      {isStaple ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.id, 'list')}
                      className="btn btn-quiet btn-sm"
                    >
                      + Liste
                    </button>
                    <button
                      type="button"
                      onClick={() => (item.quantity ? toggleMenu(item.id, 'consume') : void handleFullRemoval(item))}
                      className="btn btn-quiet btn-sm"
                    >
                      Verbraucht
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFullRemoval(item, 'discarded')}
                      className="btn-icon h-10 w-8 text-base text-ink-faint hover:text-danger"
                      aria-label="Weggeworfen"
                    >
                      🗑
                    </button>
                  </div>

                  {openMenuItemId === item.id && openMenuMode === 'consume' && item.quantity != null && (
                    <div className="popover w-52">
                      <p className="px-1 pb-1 text-xs text-ink-muted">Wie viel ist weg?</p>
                      <div className="grid grid-cols-4 gap-1">
                        {consumeFractions.map((fraction) => (
                          <button
                            key={fraction.value}
                            type="button"
                            onClick={() => applyConsumption(item, (item.quantity ?? 0) * fraction.value)}
                            className="btn btn-quiet min-h-10 rounded-md px-1 text-xs"
                          >
                            {fraction.label}
                          </button>
                        ))}
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          const value = Number(customAmount)
                          if (value > 0) applyConsumption(item, value)
                        }}
                        className="mt-2 flex gap-1"
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={`Menge${item.unit ? ` (${item.unit})` : ''}`}
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value)}
                          aria-label="Verbrauchte Menge"
                          className="field-num min-h-10 text-xs"
                        />
                        <button type="submit" className="btn btn-primary min-h-10 px-3 text-xs">
                          OK
                        </button>
                      </form>
                    </div>
                  )}

                  {openMenuItemId === item.id && openMenuMode === 'list' && (
                    <div className="popover w-52">
                      <p className="px-1 pb-1 text-xs text-ink-muted">Menge für die Einkaufsliste</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleAddToShoppingList(item, listAmount ? Number(listAmount) : null)
                        }}
                        className="flex gap-1"
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={`Menge${item.unit ? ` (${item.unit})` : ''}`}
                          value={listAmount}
                          onChange={(e) => setListAmount(e.target.value)}
                          aria-label="Menge für die Einkaufsliste"
                          className="field-num min-h-10 text-xs"
                        />
                        <button type="submit" className="btn btn-primary min-h-10 px-3 text-xs">
                          OK
                        </button>
                      </form>
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
