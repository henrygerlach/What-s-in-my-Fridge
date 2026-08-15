import { useCallback, useEffect, useState } from 'react'
import { getShoppingList, removeFromShoppingList, updateShoppingListItem, addToShoppingList } from '../lib/shoppingList'
import type { ShoppingListItem } from '../lib/shoppingList'
import { saveFoodItem, revertSaveFoodItem } from '../lib/foodItems'
import type { SaveFoodItemResult } from '../lib/foodItems'
import { classifyItem } from '../lib/classify'
import { useToast } from '../lib/ToastContext'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { groupByCategory } from '../lib/groupByCategory'
import { UNIT_OPTIONS, CATEGORY_OPTIONS, CATEGORY_ICONS, UNCATEGORIZED_ICON } from '../lib/constants'
import type { Location } from '../types'

const locationOptions: Array<{ value: Location; label: string }> = [
  { value: 'fridge', label: 'Kühlschrank' },
  { value: 'pantry', label: 'Vorrat' },
  { value: 'freezer', label: 'Gefrierfach' },
]

export default function ShoppingList() {
  const [items, setItems] = useState<ShoppingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [buyingLocation, setBuyingLocation] = useState<Location>('fridge')
  const [buyingCategory, setBuyingCategory] = useState('')
  const [buyingBusy, setBuyingBusy] = useState(false)
  const [classifyingBuy, setClassifyingBuy] = useState(false)
  const [buyingAllBusy, setBuyingAllBusy] = useState(false)
  const showToast = useToast()

  const groups = groupByCategory(items, (item) => item.category, CATEGORY_OPTIONS)

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    setItems(await getShoppingList())
    if (!options.silent) setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Someone else adding/buying items on another device should update this
  // list live instead of only after a manual refresh.
  useRealtimeRefresh(
    [{ table: 'shopping_list_items' }],
    useCallback(() => void refresh({ silent: true }), [refresh]),
  )

  async function handleRemove(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
    await removeFromShoppingList(id)
  }

  async function handleQuantityChange(id: string, value: string) {
    const quantity = value ? Number(value) : null
    setItems((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)))
    await updateShoppingListItem(id, { quantity })
  }

  async function handleUnitChange(id: string, value: string) {
    const unit = value || null
    setItems((current) => current.map((item) => (item.id === id ? { ...item, unit } : item)))
    await updateShoppingListItem(id, { unit })
  }

  async function openBuyPanel(item: ShoppingListItem) {
    setBuyingId(item.id)
    setBuyingLocation('fridge')
    setBuyingCategory(item.category ?? '')
    if (item.category) return

    setClassifyingBuy(true)
    const guess = await classifyItem(item.name)
    setClassifyingBuy(false)
    if (guess) {
      setBuyingLocation(guess.location)
      setBuyingCategory(guess.category)
    }
  }

  async function handleConfirmPurchase(item: ShoppingListItem) {
    setBuyingBusy(true)
    const result = await saveFoodItem({
      name: item.name,
      category: buyingCategory,
      quantity: item.quantity,
      unit: item.unit,
      location: buyingLocation,
      source: 'shopping',
    })
    setBuyingBusy(false)

    if (!result.ok) {
      showToast('Fehler beim Hinzufügen')
      return
    }

    await removeFromShoppingList(item.id)
    setItems((current) => current.filter((i) => i.id !== item.id))
    setBuyingId(null)

    showToast(`${item.name} ins Inventar verschoben`, {
      label: 'Rückgängig',
      onAction: async () => {
        await revertSaveFoodItem(result)
        await addToShoppingList(item.name, item.quantity, item.unit, item.category)
        void refresh()
      },
    })
  }

  async function handleBuyAll() {
    setBuyingAllBusy(true)

    // Process items in small concurrent batches instead of one at a time:
    // each item needs 3 sequential round trips (classify, save, remove),
    // but different items are independent, so batching cuts wall-clock time
    // roughly N-fold while keeping only a few requests in flight against
    // the classify-item LLM endpoint at once.
    const CONCURRENCY = 5
    const outcomes: Array<{ item: ShoppingListItem; result: SaveFoodItemResult }> = []

    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY)
      const batchOutcomes = await Promise.all(
        batch.map(async (item) => {
          const guess = item.category ? null : await classifyItem(item.name)
          const result = await saveFoodItem({
            name: item.name,
            category: item.category ?? guess?.category ?? '',
            quantity: item.quantity,
            unit: item.unit,
            location: guess?.location ?? 'fridge',
            source: 'shopping',
          })
          if (result.ok) await removeFromShoppingList(item.id)
          return { item, result }
        }),
      )
      outcomes.push(...batchOutcomes)
    }

    setBuyingAllBusy(false)
    const successCount = outcomes.filter(({ result }) => result.ok).length
    await refresh()

    showToast(`${successCount} von ${items.length} Artikeln ins Inventar verschoben`, {
      label: 'Rückgängig',
      onAction: async () => {
        await Promise.all(
          outcomes
            .filter(({ result }) => result.ok)
            .map(async ({ item, result }) => {
              await revertSaveFoodItem(result)
              await addToShoppingList(item.name, item.quantity, item.unit, item.category)
            }),
        )
        void refresh()
      },
    })
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Einkaufsliste</h1>
        {items.length > 0 && (
          <button
            type="button"
            onClick={handleBuyAll}
            disabled={buyingAllBusy}
            className="shrink-0 rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {buyingAllBusy ? 'Speichert...' : 'Alle ins Inventar'}
          </button>
        )}
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Lädt...</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">Deine Einkaufsliste ist leer.</p>
      ) : (
        groups.map(([categoryLabel, groupItems]) => (
          <div key={categoryLabel} className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON} {categoryLabel}
            </h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {groupItems.map((item) => (
                <li key={item.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openBuyPanel(item)}
                      className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      Gekauft
                    </button>
                    <span className="min-w-0 flex-1 truncate text-gray-900">{item.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="Menge"
                      value={item.quantity ?? ''}
                      onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                      className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <select
                      value={item.unit ?? ''}
                      onChange={(e) => handleUnitChange(item.id, e.target.value)}
                      className="w-20 rounded border border-gray-300 bg-white px-1 py-1 text-sm"
                    >
                      <option value="">–</option>
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      className="shrink-0 text-xs font-medium text-gray-500"
                    >
                      Entfernen
                    </button>
                  </div>

                  {buyingId === item.id && (
                    <div className="mt-2 rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-500">
                        Wohin damit?{classifyingBuy && <span className="ml-1 text-gray-400">wird vorgeschlagen...</span>}
                      </p>
                      <div className="mt-1 flex gap-2">
                        {locationOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            disabled={classifyingBuy}
                            onClick={() => setBuyingLocation(option.value)}
                            className={`flex-1 rounded-lg px-2 py-1.5 text-xs disabled:opacity-50 ${
                              buyingLocation === option.value ? 'bg-black text-white' : 'bg-white text-gray-600'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setBuyingId(null)}
                          className="flex-1 rounded-lg bg-white py-1.5 text-xs font-medium text-gray-600"
                        >
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmPurchase(item)}
                          disabled={buyingBusy || classifyingBuy}
                          className="flex-[2] rounded-lg bg-black py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {buyingBusy ? 'Speichert...' : 'Ins Inventar aufnehmen'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
