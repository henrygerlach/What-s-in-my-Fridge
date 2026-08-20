import { useCallback, useEffect, useState } from 'react'
import { getShoppingList, removeFromShoppingList, updateShoppingListItem, addToShoppingList } from '../lib/shoppingList'
import type { ShoppingListItem } from '../lib/shoppingList'
import { saveFoodItem, revertSaveFoodItem } from '../lib/foodItems'
import type { SaveFoodItemResult } from '../lib/foodItems'
import { classifyItem } from '../lib/classify'
import { useToast } from '../lib/ToastContext'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { groupByCategory } from '../lib/groupByCategory'
import {
  UNIT_OPTIONS,
  CATEGORY_OPTIONS,
  CATEGORY_ICONS,
  UNCATEGORIZED_ICON,
  LOCATION_OPTIONS,
  LOCATION_DOT_CLASS,
} from '../lib/constants'
import PageHeader from '../components/PageHeader'
import type { Location } from '../types'

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
    <div className="page">
      <PageHeader title="Einkaufsliste">
        {items.length > 0 && (
          <button type="button" onClick={handleBuyAll} disabled={buyingAllBusy} className="btn btn-primary btn-sm">
            {buyingAllBusy ? 'Speichert...' : 'Alle ins Inventar'}
          </button>
        )}
      </PageHeader>

      {loading ? (
        <p className="mt-8 text-center text-sm text-ink-faint">Lädt...</p>
      ) : items.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-ink-muted">Deine Einkaufsliste ist leer.</p>
          <p className="mt-1 text-sm text-ink-faint">
            Fehlende Zutaten landen hier, sobald du sie in einem Rezept oder im Inventar zur Liste hinzufügst.
          </p>
        </div>
      ) : (
        groups.map(([categoryLabel, groupItems]) => (
          <div key={categoryLabel} className="mt-5">
            <h2 className="shelf-label">
              <span aria-hidden>{CATEGORY_ICONS[categoryLabel] ?? UNCATEGORIZED_ICON}</span>
              {categoryLabel}
            </h2>
            <ul className="mt-1 divide-y divide-rule">
              {groupItems.map((item) => (
                <li key={item.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openBuyPanel(item)} className="btn btn-outline btn-sm shrink-0">
                      Gekauft
                    </button>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="–"
                      value={item.quantity ?? ''}
                      onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                      aria-label={`Menge für ${item.name}`}
                      className="field-num min-h-10 w-14 px-1 text-xs"
                    />
                    <select
                      value={item.unit ?? ''}
                      onChange={(e) => handleUnitChange(item.id, e.target.value)}
                      aria-label={`Einheit für ${item.name}`}
                      className="field min-h-10 w-20 px-1 py-1 text-xs"
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
                      className="btn-icon h-10 w-8 text-lg text-ink-faint hover:text-danger"
                      aria-label={`${item.name} von der Liste entfernen`}
                    >
                      ×
                    </button>
                  </div>

                  {buyingId === item.id && (
                    <div className="card mt-2 bg-porcelain p-2.5">
                      <p className="text-xs text-ink-muted">
                        Wohin damit?
                        {classifyingBuy && <span className="ml-1 text-ink-faint">wird vorgeschlagen...</span>}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {LOCATION_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            disabled={classifyingBuy}
                            onClick={() => setBuyingLocation(option.value)}
                            aria-pressed={buyingLocation === option.value}
                            className={`btn btn-sm min-h-10 flex-1 px-1 ${
                              buyingLocation === option.value ? 'btn-primary' : 'btn-outline'
                            }`}
                          >
                            <span
                              className={`dot ${
                                buyingLocation === option.value ? 'bg-white' : LOCATION_DOT_CLASS[option.value]
                              }`}
                              aria-hidden
                            />
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => setBuyingId(null)} className="btn btn-quiet btn-sm flex-1">
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmPurchase(item)}
                          disabled={buyingBusy || classifyingBuy}
                          className="btn btn-primary btn-sm flex-[2]"
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
