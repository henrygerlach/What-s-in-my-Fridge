import { describe, it, expect, vi } from 'vitest'
import { logInventoryAddition, loadRecentInventoryLog } from './inventoryLog'
import { seed, rows } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('logInventoryAddition', () => {
  it('stores the addition verbatim', async () => {
    await logInventoryAddition({
      name: 'Tomaten',
      category: 'Obst & Gemüse',
      quantity: 400,
      unit: 'g',
      location: 'pantry',
      source: 'receipt',
    })
    expect(rows('inventory_log')[0]).toMatchObject({
      name: 'Tomaten',
      category: 'Obst & Gemüse',
      quantity: 400,
      unit: 'g',
      location: 'pantry',
      source: 'receipt',
    })
  })
})

describe('loadRecentInventoryLog', () => {
  it('returns an empty log when nothing was added', async () => {
    expect(await loadRecentInventoryLog('2026-06-01T00:00:00.000Z')).toEqual([])
  })

  it('returns only entries at or after the cutoff, newest first', async () => {
    seed('inventory_log', [
      { id: 'old', logged_at: '2026-05-01T00:00:00.000Z' },
      { id: 'new', logged_at: '2026-06-10T00:00:00.000Z' },
      { id: 'edge', logged_at: '2026-06-01T00:00:00.000Z' },
    ])
    const result = await loadRecentInventoryLog('2026-06-01T00:00:00.000Z')
    expect(result.map((entry) => entry.id)).toEqual(['new', 'edge'])
  })
})
