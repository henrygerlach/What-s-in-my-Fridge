import { describe, it, expect, vi } from 'vitest'
import { logCookedRecipe, loadRecentCookLog, loadLastCookedMap } from './cookLog'
import { seed, rows } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('logCookedRecipe', () => {
  it('records that a recipe was cooked', async () => {
    await logCookedRecipe('r1')
    expect(rows('recipe_cook_log')[0]).toMatchObject({ recipe_id: 'r1' })
  })
})

describe('loadRecentCookLog', () => {
  it('returns an empty log when nothing was cooked', async () => {
    expect(await loadRecentCookLog('2026-06-01T00:00:00.000Z')).toEqual([])
  })

  it('joins in the recipe title, newest first', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_cook_log', [
      { recipe_id: 'r1', cooked_at: '2026-06-02T00:00:00.000Z' },
      { recipe_id: 'r1', cooked_at: '2026-06-05T00:00:00.000Z' },
    ])
    const result = await loadRecentCookLog('2026-06-01T00:00:00.000Z')
    expect(result).toEqual([
      { recipe_id: 'r1', cooked_at: '2026-06-05T00:00:00.000Z', recipe_title: 'Chili' },
      { recipe_id: 'r1', cooked_at: '2026-06-02T00:00:00.000Z', recipe_title: 'Chili' },
    ])
  })

  // The log outlives the recipe row; a deleted recipe must not break the read.
  it('yields a null title for a recipe that was since deleted', async () => {
    seed('recipe_cook_log', [{ recipe_id: 'gone', cooked_at: '2026-06-02T00:00:00.000Z' }])
    const result = await loadRecentCookLog('2026-06-01T00:00:00.000Z')
    expect(result[0].recipe_title).toBeNull()
  })

  it('excludes entries older than the cutoff', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_cook_log', [{ recipe_id: 'r1', cooked_at: '2026-01-01T00:00:00.000Z' }])
    expect(await loadRecentCookLog('2026-06-01T00:00:00.000Z')).toEqual([])
  })
})

describe('loadLastCookedMap', () => {
  it('is empty when nothing was cooked', async () => {
    expect(await loadLastCookedMap()).toEqual(new Map())
  })

  it('keeps only the most recent cook per recipe', async () => {
    seed('recipe_cook_log', [
      { recipe_id: 'r1', cooked_at: '2026-06-01T00:00:00.000Z' },
      { recipe_id: 'r1', cooked_at: '2026-06-09T00:00:00.000Z' },
      { recipe_id: 'r2', cooked_at: '2026-06-03T00:00:00.000Z' },
    ])
    const map = await loadLastCookedMap()
    expect(map.get('r1')).toBe('2026-06-09T00:00:00.000Z')
    expect(map.get('r2')).toBe('2026-06-03T00:00:00.000Z')
    expect(map.size).toBe(2)
  })
})
