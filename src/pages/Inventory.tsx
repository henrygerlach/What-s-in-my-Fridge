import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { useClickOutside } from '../lib/useClickOutside'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { groupByCategory } from '../lib/groupByCategory'
import { CATEGORY_OPTIONS, CATEGORY_ICONS, UNCATEGORIZED_ICON } from '../lib/constants'
import { loadRecipesWithAvailability } from '../lib/recipeAvailability'
import type { RecipeWithAvailability } from '../lib/recipeAvailability'
import { currentMealCategory, MEAL_CATEGORY_LABELS } from '../lib/mealTime'
import { addToShoppingList, getShoppingList } from '../lib/shoppingList'
import type { ShoppingListItem } from '../lib/shoppingList'
import { addStapleItem, getMissingStaples, getStapleItems, removeStapleItem } from '../lib/stapleItems'
import { isMatch } from '../lib/matching'
import { logConsumption } from '../lib/consumptionLog'
import type { FoodItem, Location, StapleItem } from '../types'

const locationLabels: Record<Location, string> = {
  fridge: 'Kühlschrank',
  pantry: 'Vorrat',
  freezer: 'Gefrierfach',
}

const filters: Array<{ value: Location | 'all'; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'fridge', label: 'Kühlschrank' },
  { value: 'pantry', label: 'Vorrat' },
  { value: 'freezer', label: 'Gefrierfach' },
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
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventar</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/waste"
            className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600"
          >
            Statistik
          </Link>
          {items.length > 0 && (
            <div ref={confirmingClearAll ? clearAllMenuRef : undefined} className="relative">
              <button
                type="button"
                onClick={() => setConfirmingClearAll((current) => !current)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600"
              >
                Inventar leeren
              </button>
              {confirmingClearAll && (
                <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                  <p className="text-xs text-gray-500">{items.length} Artikel wirklich löschen?</p>
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmingClearAll(false)}
                      className="flex-1 rounded-md bg-gray-100 px-1 py-1 text-xs text-gray-700"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      disabled={clearingAll}
                      className="flex-1 rounded-md bg-red-600 px-1 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {clearingAll ? '...' : 'Löschen'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Link
            to="/add"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-lg font-semibold text-white"
          >
            +
          </Link>
        </div>
      </div>

      {missingStaples.length > 0 && (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-orange-600">Standardvorrat leer</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {missingStaples.map((staple) => (
              <li key={staple.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-gray-900">{staple.name}</span>
                <button
                  type="button"
                  onClick={() => handleAddStapleToShoppingList(staple)}
                  className="shrink-0 text-xs font-medium text-blue-600"
                >
                  + Zur Liste
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topRecipes.length > 0 && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {MEAL_CATEGORY_LABELS[mealCategory] ?? 'Was koche ich heute?'}
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {topRecipes.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  to={`/recipes/${recipe.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-gray-900">{recipe.title}</span>
                  <span
                    className={`shrink-0 whitespace-nowrap text-xs font-medium ${
                      recipe.available === recipe.total ? 'text-green-600' : 'text-gray-500'
                    }`}
                  >
                    {recipe.available}/{recipe.total} Zutaten
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Suchen..."
        className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="mt-3 flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${
              filter === f.value ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Lädt...</p>
      ) : visibleItems.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">Keine Lebensmittel gefunden.</p>
      ) : (
        groups.map(([categoryLabel, groupItems]) => (
          <div key={categoryLabel} className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON} {categoryLabel}
            </h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {groupItems.map((item) => {
                const isStaple = staples.some((staple) => isMatch(staple.name, item.name))
                return (
                <li
                  key={item.id}
                  ref={openMenuItemId === item.id ? menuContainerRef : undefined}
                  className="relative flex items-center justify-between py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {locationLabels[item.location]}
                      {item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleStaple(item)}
                      className={`text-base ${isStaple ? 'text-amber-500' : 'text-gray-400'}`}
                      aria-label={isStaple ? 'Standardvorrat entfernen' : 'Als Standardvorrat markieren'}
                    >
                      {isStaple ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.id, 'list')}
                      className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      Einkaufsliste
                    </button>
                    <button
                      type="button"
                      onClick={() => (item.quantity ? toggleMenu(item.id, 'consume') : void handleFullRemoval(item))}
                      className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      Verbraucht
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFullRemoval(item, 'discarded')}
                      className="text-base text-gray-400"
                      aria-label="Weggeworfen"
                    >
                      🗑
                    </button>
                  </div>

                  {openMenuItemId === item.id && openMenuMode === 'consume' && item.quantity != null && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                      <div className="grid grid-cols-4 gap-1">
                        {consumeFractions.map((fraction) => (
                          <button
                            key={fraction.value}
                            type="button"
                            onClick={() => applyConsumption(item, (item.quantity ?? 0) * fraction.value)}
                            className="rounded-md bg-gray-100 px-1 py-1 text-xs text-gray-700"
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
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded-md bg-black px-2 py-1 text-xs text-white">
                          OK
                        </button>
                      </form>
                    </div>
                  )}

                  {openMenuItemId === item.id && openMenuMode === 'list' && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                      <p className="text-xs text-gray-500">Menge für die Einkaufsliste</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleAddToShoppingList(item, listAmount ? Number(listAmount) : null)
                        }}
                        className="mt-1 flex gap-1"
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={`Menge${item.unit ? ` (${item.unit})` : ''}`}
                          value={listAmount}
                          onChange={(e) => setListAmount(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded-md bg-black px-2 py-1 text-xs text-white">
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
