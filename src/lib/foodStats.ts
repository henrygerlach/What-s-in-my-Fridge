import type { ConsumptionLogEntry } from './consumptionLog'
import type { CookLogEntry } from './cookLog'

export interface GoodUsage {
  name: string
  count: number
  // Only summed when every contributing entry shares the same unit —
  // otherwise left null rather than adding incompatible units together.
  totalQuantity: number | null
  unit: string | null
}

// Ranks items by how often they were fully used up or thrown out (count is
// unit-agnostic and so always comparable, unlike summed quantity).
export function rankGoodsByUsage(entries: ConsumptionLogEntry[]): GoodUsage[] {
  const map = new Map<string, GoodUsage>()
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase()
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      if (existing.totalQuantity != null && entry.quantity != null && entry.unit === existing.unit) {
        existing.totalQuantity += entry.quantity
      } else {
        existing.totalQuantity = null
      }
    } else {
      map.set(key, { name: entry.name, count: 1, totalQuantity: entry.quantity, unit: entry.unit })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export interface RecipeUsage {
  recipeId: string
  title: string
  count: number
  lastCookedAt: string
}

// Ranks recipes by how often they were cooked in the window, skipping
// entries whose recipe was later deleted (no title to show).
export function rankCookedRecipes(entries: CookLogEntry[]): RecipeUsage[] {
  const map = new Map<string, RecipeUsage>()
  for (const entry of entries) {
    if (!entry.recipe_title) continue
    const existing = map.get(entry.recipe_id)
    if (existing) {
      existing.count += 1
    } else {
      map.set(entry.recipe_id, {
        recipeId: entry.recipe_id,
        title: entry.recipe_title,
        count: 1,
        lastCookedAt: entry.cooked_at,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

// Average days between an item entering inventory and leaving it (consumed
// or discarded), overall. Only entries stamped with item_added_at count —
// older log rows predating that column are silently skipped.
export function averageDaysInStorage(entries: ConsumptionLogEntry[]): number | null {
  const spans = entries
    .filter((entry) => entry.item_added_at)
    .map((entry) => (new Date(entry.logged_at).getTime() - new Date(entry.item_added_at as string).getTime()) / 86_400_000)
    .filter((days) => days >= 0)
  if (spans.length === 0) return null
  return spans.reduce((sum, days) => sum + days, 0) / spans.length
}

export interface CategoryWaste {
  category: string
  count: number
}

// Which categories get thrown away most often, for a quick "you mostly waste
// X" pointer beyond the flat waste-rate number.
export function rankWasteByCategory(entries: ConsumptionLogEntry[]): CategoryWaste[] {
  const map = new Map<string, number>()
  for (const entry of entries) {
    if (entry.reason !== 'discarded') continue
    const category = entry.category ?? 'Ohne Kategorie'
    map.set(category, (map.get(category) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

export interface PeriodTotals {
  label: string
  consumed: number
  discarded: number
}

// Buckets consumption entries into fixed-size day windows so the
// consumed-vs-discarded trend can be charted instead of only summed.
// Returned oldest-first (left-to-right on a chart); the last bucket may
// cover fewer than bucketDays days if windowDays doesn't divide evenly.
export function bucketConsumptionTrend(
  entries: ConsumptionLogEntry[],
  windowDays: number,
  bucketDays: number,
): PeriodTotals[] {
  const bucketCount = Math.ceil(windowDays / bucketDays)
  const now = Date.now()

  const buckets: PeriodTotals[] = Array.from({ length: bucketCount }, (_, i) => {
    const bucketsAgo = bucketCount - 1 - i
    const start = new Date(now - (bucketsAgo + 1) * bucketDays * 86_400_000)
    return { label: `${start.getDate()}.${start.getMonth() + 1}.`, consumed: 0, discarded: 0 }
  })

  for (const entry of entries) {
    const daysAgo = (now - new Date(entry.logged_at).getTime()) / 86_400_000
    const bucketsAgo = Math.floor(daysAgo / bucketDays)
    const index = bucketCount - 1 - bucketsAgo
    if (index < 0 || index >= bucketCount) continue
    if (entry.reason === 'consumed') buckets[index].consumed += 1
    else buckets[index].discarded += 1
  }

  return buckets
}
