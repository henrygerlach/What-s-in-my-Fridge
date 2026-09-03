import { describe, it, expect, vi } from 'vitest'
import {
  formatDateKey,
  formatDayLabel,
  upcomingDays,
  getMealPlanRange,
  addMealPlanItem,
  removeMealPlanItem,
  aggregateIngredients,
} from './mealPlan'
import { seed, rows } from '../test/fakeSupabase'
import type { RecipeIngredient } from '../types'

vi.mock('./supabase')

function ingredient(overrides: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    id: 'i1',
    recipe_id: 'r1',
    name: 'Tomaten',
    quantity: 100,
    unit: 'g',
    grams_per_unit: null,
    ...overrides,
  } as RecipeIngredient
}

describe('formatDateKey', () => {
  it('formats as local YYYY-MM-DD with zero padding', () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  // toISOString() would shift late-evening local times into the next UTC day
  // and silently plan the meal for the wrong date.
  it('does not shift the day for a late-evening local time', () => {
    expect(formatDateKey(new Date(2026, 5, 15, 23, 30))).toBe('2026-06-15')
  })
})

describe('formatDayLabel', () => {
  it('prefixes the German weekday abbreviation', () => {
    expect(formatDayLabel(new Date(2026, 5, 15))).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So) 15\.06\.$/)
  })

  it('zero-pads day and month', () => {
    expect(formatDayLabel(new Date(2026, 0, 4))).toMatch(/ 04\.01\.$/)
  })

  it('covers every weekday label', () => {
    const labels = Array.from({ length: 7 }, (_, i) => formatDayLabel(new Date(2026, 5, 14 + i)).slice(0, 2))
    expect(new Set(labels)).toEqual(new Set(['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']))
  })
})

describe('upcomingDays', () => {
  it('returns consecutive days starting from the given date', () => {
    const days = upcomingDays(3, new Date(2026, 5, 15))
    expect(days.map(formatDateKey)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17'])
  })

  it('rolls over a month boundary', () => {
    const days = upcomingDays(2, new Date(2026, 5, 30))
    expect(days.map(formatDateKey)).toEqual(['2026-06-30', '2026-07-01'])
  })

  it('returns nothing for a count of zero', () => {
    expect(upcomingDays(0, new Date(2026, 5, 15))).toEqual([])
  })

  it('defaults to today', () => {
    expect(upcomingDays(1)).toHaveLength(1)
  })
})

describe('getMealPlanRange', () => {
  it('returns an empty plan when nothing is scheduled', async () => {
    expect(await getMealPlanRange('2026-06-01', '2026-06-07')).toEqual([])
  })

  it('returns only entries inside the range, oldest first', async () => {
    seed('meal_plan_items', [
      { id: 'c', plan_date: '2026-06-09', created_at: '2026-06-03T00:00:00.000Z' },
      { id: 'b', plan_date: '2026-06-05', created_at: '2026-06-02T00:00:00.000Z' },
      { id: 'a', plan_date: '2026-06-01', created_at: '2026-06-01T00:00:00.000Z' },
    ])
    const result = await getMealPlanRange('2026-06-01', '2026-06-07')
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('includes both range endpoints', async () => {
    seed('meal_plan_items', [
      { id: 'start', plan_date: '2026-06-01' },
      { id: 'end', plan_date: '2026-06-07' },
    ])
    expect(await getMealPlanRange('2026-06-01', '2026-06-07')).toHaveLength(2)
  })
})

describe('addMealPlanItem / removeMealPlanItem', () => {
  it('inserts the planned recipe', async () => {
    await addMealPlanItem('2026-06-15', 'recipe-1', 4)
    expect(rows('meal_plan_items')[0]).toMatchObject({ plan_date: '2026-06-15', recipe_id: 'recipe-1', portions: 4 })
  })

  it('accepts a null portion count', async () => {
    await addMealPlanItem('2026-06-15', 'recipe-1', null)
    expect(rows('meal_plan_items')[0].portions).toBeNull()
  })

  it('removes only the given entry', async () => {
    seed('meal_plan_items', [{ id: 'a' }, { id: 'b' }])
    await removeMealPlanItem('a')
    expect(rows('meal_plan_items').map((item) => item.id)).toEqual(['b'])
  })
})

describe('aggregateIngredients', () => {
  it('returns nothing for no occurrences', () => {
    expect(aggregateIngredients([])).toEqual([])
  })

  it('scales each occurrence by its portion ratio', () => {
    const result = aggregateIngredients([{ ingredients: [ingredient({ quantity: 100 })], ratio: 2 }])
    expect(result).toEqual([{ name: 'Tomaten', quantity: 200, unit: 'g', grams_per_unit: null }])
  })

  it('rounds a scaled quantity to two decimals', () => {
    const result = aggregateIngredients([{ ingredients: [ingredient({ quantity: 100 })], ratio: 1 / 3 }])
    expect(result[0].quantity).toBe(33.33)
  })

  // Two recipes in the same week both wanting tomatoes must produce one
  // shopping list line, not two.
  it('merges the same ingredient across occurrences', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ quantity: 100 })], ratio: 1 },
      { ingredients: [ingredient({ quantity: 250 })], ratio: 1 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(350)
  })

  it('merges case- and whitespace-insensitively but keeps the first spelling', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ name: 'Tomaten', quantity: 100 })], ratio: 1 },
      { ingredients: [ingredient({ name: ' tomaten ', quantity: 100 })], ratio: 1 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Tomaten')
  })

  it('keeps different units as separate lines', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ quantity: 1, unit: 'Dose' }), ingredient({ quantity: 100, unit: 'g' })], ratio: 1 },
    ])
    expect(result).toHaveLength(2)
  })

  it('falls back to quantity-less when any contributing entry has no quantity', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ quantity: 100 })], ratio: 1 },
      { ingredients: [ingredient({ quantity: null })], ratio: 1 },
    ])
    expect(result[0].quantity).toBeNull()
  })

  it('stays quantity-less once it already is', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ quantity: null })], ratio: 1 },
      { ingredients: [ingredient({ quantity: 100 })], ratio: 1 },
    ])
    expect(result[0].quantity).toBeNull()
  })

  it('carries grams_per_unit from the first occurrence', () => {
    const result = aggregateIngredients([
      { ingredients: [ingredient({ unit: 'Dose', quantity: 1, grams_per_unit: 400 })], ratio: 1 },
    ])
    expect(result[0].grams_per_unit).toBe(400)
  })
})
