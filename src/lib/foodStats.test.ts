import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  rankGoodsByUsage,
  rankCookedRecipes,
  averageDaysInStorage,
  rankWasteByCategory,
  bucketConsumptionTrend,
} from './foodStats'
import type { ConsumptionLogEntry } from './consumptionLog'
import type { CookLogEntry } from './cookLog'

function entry(overrides: Partial<ConsumptionLogEntry>): ConsumptionLogEntry {
  return {
    id: 'id',
    name: 'Milch',
    category: 'Milchprodukte & Eier',
    quantity: 1,
    unit: 'l',
    reason: 'consumed',
    source: 'manual',
    recipe_title: null,
    item_added_at: null,
    logged_at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('rankGoodsByUsage', () => {
  it('returns nothing for no entries', () => {
    expect(rankGoodsByUsage([])).toEqual([])
  })

  it('counts occurrences per item, case- and whitespace-insensitively', () => {
    const result = rankGoodsByUsage([
      entry({ name: 'Milch' }),
      entry({ name: ' milch ' }),
      entry({ name: 'Butter' }),
    ])
    expect(result).toEqual([
      { name: 'Milch', count: 2, totalQuantity: 2, unit: 'l' },
      { name: 'Butter', count: 1, totalQuantity: 1, unit: 'l' },
    ])
  })

  it('sorts by count, most-used first', () => {
    const result = rankGoodsByUsage([
      entry({ name: 'Butter' }),
      entry({ name: 'Milch' }),
      entry({ name: 'Milch' }),
    ])
    expect(result.map((good) => good.name)).toEqual(['Milch', 'Butter'])
  })

  // Adding 2 l to 500 g would produce a meaningless number, so the sum is
  // abandoned rather than fudged.
  it('refuses to total quantities across different units', () => {
    const [good] = rankGoodsByUsage([
      entry({ name: 'Milch', quantity: 1, unit: 'l' }),
      entry({ name: 'Milch', quantity: 500, unit: 'ml' }),
    ])
    expect(good).toEqual({ name: 'Milch', count: 2, totalQuantity: null, unit: 'l' })
  })

  it('abandons the total once any contributing entry has no quantity', () => {
    const [good] = rankGoodsByUsage([
      entry({ name: 'Milch', quantity: 1, unit: 'l' }),
      entry({ name: 'Milch', quantity: null, unit: 'l' }),
    ])
    expect(good.totalQuantity).toBeNull()
    expect(good.count).toBe(2)
  })

  it('keeps a null total null even if a later entry has a quantity', () => {
    const [good] = rankGoodsByUsage([
      entry({ name: 'Milch', quantity: null, unit: 'l' }),
      entry({ name: 'Milch', quantity: 2, unit: 'l' }),
    ])
    expect(good.totalQuantity).toBeNull()
  })
})

describe('rankCookedRecipes', () => {
  function cooked(overrides: Partial<CookLogEntry>): CookLogEntry {
    return { recipe_id: 'r1', cooked_at: '2026-06-01T12:00:00.000Z', recipe_title: 'Chili', ...overrides }
  }

  it('returns nothing for no entries', () => {
    expect(rankCookedRecipes([])).toEqual([])
  })

  it('counts cooks per recipe and sorts by count', () => {
    const result = rankCookedRecipes([
      cooked({ recipe_id: 'r1', recipe_title: 'Chili' }),
      cooked({ recipe_id: 'r2', recipe_title: 'Pasta' }),
      cooked({ recipe_id: 'r1', recipe_title: 'Chili' }),
    ])
    expect(result.map((usage) => [usage.title, usage.count])).toEqual([
      ['Chili', 2],
      ['Pasta', 1],
    ])
  })

  // The log outlives the recipe row, so deleted recipes come back title-less.
  it('skips entries whose recipe was deleted', () => {
    expect(rankCookedRecipes([cooked({ recipe_title: null })])).toEqual([])
  })

  it('keeps the first entry’s timestamp as lastCookedAt', () => {
    const [usage] = rankCookedRecipes([
      cooked({ cooked_at: '2026-06-05T00:00:00.000Z' }),
      cooked({ cooked_at: '2026-06-01T00:00:00.000Z' }),
    ])
    expect(usage.lastCookedAt).toBe('2026-06-05T00:00:00.000Z')
  })
})

describe('averageDaysInStorage', () => {
  it('is null when nothing has an added-at stamp', () => {
    expect(averageDaysInStorage([])).toBeNull()
    expect(averageDaysInStorage([entry({ item_added_at: null })])).toBeNull()
  })

  it('averages the days between adding and removing', () => {
    const result = averageDaysInStorage([
      entry({ item_added_at: '2026-06-01T00:00:00.000Z', logged_at: '2026-06-05T00:00:00.000Z' }),
      entry({ item_added_at: '2026-06-01T00:00:00.000Z', logged_at: '2026-06-03T00:00:00.000Z' }),
    ])
    expect(result).toBe(3)
  })

  it('ignores entries logged before they were added', () => {
    const result = averageDaysInStorage([
      entry({ item_added_at: '2026-06-10T00:00:00.000Z', logged_at: '2026-06-01T00:00:00.000Z' }),
      entry({ item_added_at: '2026-06-01T00:00:00.000Z', logged_at: '2026-06-03T00:00:00.000Z' }),
    ])
    expect(result).toBe(2)
  })
})

describe('rankWasteByCategory', () => {
  it('counts only discarded entries', () => {
    const result = rankWasteByCategory([
      entry({ reason: 'discarded', category: 'Obst & Gemüse' }),
      entry({ reason: 'consumed', category: 'Obst & Gemüse' }),
    ])
    expect(result).toEqual([{ category: 'Obst & Gemüse', count: 1 }])
  })

  it('sorts categories by waste count', () => {
    const result = rankWasteByCategory([
      entry({ reason: 'discarded', category: 'Getränke' }),
      entry({ reason: 'discarded', category: 'Obst & Gemüse' }),
      entry({ reason: 'discarded', category: 'Obst & Gemüse' }),
    ])
    expect(result.map((waste) => waste.category)).toEqual(['Obst & Gemüse', 'Getränke'])
  })

  it('labels entries with no category', () => {
    expect(rankWasteByCategory([entry({ reason: 'discarded', category: null })])).toEqual([
      { category: 'Ohne Kategorie', count: 1 },
    ])
  })

  it('returns nothing when nothing was discarded', () => {
    expect(rankWasteByCategory([entry({ reason: 'consumed' })])).toEqual([])
  })
})

describe('bucketConsumptionTrend', () => {
  const NOW = new Date('2026-06-30T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function daysAgo(days: number): string {
    return new Date(NOW.getTime() - days * 86_400_000).toISOString()
  }

  it('produces one bucket per window slice, oldest first', () => {
    const buckets = bucketConsumptionTrend([], 30, 5)
    expect(buckets).toHaveLength(6)
    expect(buckets.every((bucket) => bucket.consumed === 0 && bucket.discarded === 0)).toBe(true)
  })

  it('rounds up when the bucket size does not divide the window', () => {
    expect(bucketConsumptionTrend([], 30, 7)).toHaveLength(5)
  })

  it('puts recent entries in the last bucket and older ones earlier', () => {
    const buckets = bucketConsumptionTrend(
      [
        entry({ logged_at: daysAgo(1), reason: 'consumed' }),
        entry({ logged_at: daysAgo(27), reason: 'discarded' }),
      ],
      30,
      5,
    )
    expect(buckets[5]).toMatchObject({ consumed: 1, discarded: 0 })
    expect(buckets[0]).toMatchObject({ consumed: 0, discarded: 1 })
  })

  it('separates consumed from discarded within a bucket', () => {
    const buckets = bucketConsumptionTrend(
      [
        entry({ logged_at: daysAgo(1), reason: 'consumed' }),
        entry({ logged_at: daysAgo(2), reason: 'consumed' }),
        entry({ logged_at: daysAgo(3), reason: 'discarded' }),
      ],
      30,
      5,
    )
    expect(buckets[5]).toMatchObject({ consumed: 2, discarded: 1 })
  })

  it('drops entries older than the window', () => {
    const buckets = bucketConsumptionTrend([entry({ logged_at: daysAgo(200) })], 30, 5)
    expect(buckets.reduce((sum, bucket) => sum + bucket.consumed + bucket.discarded, 0)).toBe(0)
  })

  it('labels every bucket with a day.month string', () => {
    for (const bucket of bucketConsumptionTrend([], 30, 5)) {
      expect(bucket.label).toMatch(/^\d{1,2}\.\d{1,2}\.$/)
    }
  })
})
