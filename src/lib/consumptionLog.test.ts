import { describe, it, expect, vi } from 'vitest'
import { logConsumption, loadRecentConsumptionLog } from './consumptionLog'
import { seed, rows } from '../test/fakeSupabase'
import type { FoodItem } from '../types'

vi.mock('./supabase')

const item = {
  id: 'f1',
  name: 'Milch',
  category: 'Milchprodukte & Eier',
  quantity: 2,
  unit: 'l',
  location: 'fridge',
  created_at: '2026-06-01T00:00:00.000Z',
} as FoodItem

describe('logConsumption', () => {
  it('defaults to the item’s full quantity and a manual source', async () => {
    await logConsumption(item, 'consumed')
    expect(rows('consumption_log')[0]).toMatchObject({
      name: 'Milch',
      category: 'Milchprodukte & Eier',
      quantity: 2,
      unit: 'l',
      reason: 'consumed',
      source: 'manual',
      recipe_title: null,
      item_added_at: '2026-06-01T00:00:00.000Z',
    })
  })

  it('records a partial amount when one is given', async () => {
    await logConsumption(item, 'consumed', { quantity: 0.5 })
    expect(rows('consumption_log')[0].quantity).toBe(0.5)
  })

  // `?? item.quantity` treats an explicit null as "not supplied", so a null
  // still logs the item's full amount. No caller passes null; this pins the
  // behaviour so a future one is not surprised by it.
  it('treats an explicit null quantity as "not supplied"', async () => {
    await logConsumption(item, 'consumed', { quantity: null })
    expect(rows('consumption_log')[0].quantity).toBe(2)
  })

  it('logs a null quantity when the item itself has none', async () => {
    await logConsumption({ ...item, quantity: null } as FoodItem, 'consumed')
    expect(rows('consumption_log')[0].quantity).toBeNull()
  })

  it('attributes consumption to a cooked recipe', async () => {
    await logConsumption(item, 'consumed', { source: 'cooked', recipeTitle: 'Chili' })
    expect(rows('consumption_log')[0]).toMatchObject({ source: 'cooked', recipe_title: 'Chili' })
  })

  it('records a discard', async () => {
    await logConsumption(item, 'discarded')
    expect(rows('consumption_log')[0].reason).toBe('discarded')
  })

  it('normalizes a blank category to null', async () => {
    await logConsumption({ ...item, category: '' } as FoodItem, 'consumed')
    expect(rows('consumption_log')[0].category).toBeNull()
  })
})

describe('loadRecentConsumptionLog', () => {
  it('returns an empty log when nothing was consumed', async () => {
    expect(await loadRecentConsumptionLog('2026-06-01T00:00:00.000Z')).toEqual([])
  })

  it('returns only entries at or after the cutoff, newest first', async () => {
    seed('consumption_log', [
      { id: 'old', logged_at: '2026-05-01T00:00:00.000Z' },
      { id: 'new', logged_at: '2026-06-10T00:00:00.000Z' },
      { id: 'mid', logged_at: '2026-06-05T00:00:00.000Z' },
    ])
    const result = await loadRecentConsumptionLog('2026-06-01T00:00:00.000Z')
    expect(result.map((entry) => entry.id)).toEqual(['new', 'mid'])
  })
})
