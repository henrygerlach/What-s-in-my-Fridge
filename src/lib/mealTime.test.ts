import { describe, it, expect } from 'vitest'
import { currentMealCategory, MEAL_CATEGORY_LABELS } from './mealTime'

function at(hour: number): Date {
  return new Date(2026, 0, 15, hour, 0, 0)
}

describe('currentMealCategory', () => {
  it('suggests breakfast before 11:00', () => {
    expect(currentMealCategory(at(0))).toBe('Frühstück')
    expect(currentMealCategory(at(7))).toBe('Frühstück')
    expect(currentMealCategory(at(10))).toBe('Frühstück')
  })

  it('suggests a main meal from 11:00 onward', () => {
    expect(currentMealCategory(at(11))).toBe('Große Mahlzeit')
    expect(currentMealCategory(at(18))).toBe('Große Mahlzeit')
    expect(currentMealCategory(at(23))).toBe('Große Mahlzeit')
  })

  it('defaults to the current time when no date is given', () => {
    expect(['Frühstück', 'Große Mahlzeit']).toContain(currentMealCategory())
  })

  it('has a display label for every category it can return', () => {
    for (const hour of [0, 11]) {
      expect(MEAL_CATEGORY_LABELS[currentMealCategory(at(hour))]).toBeTruthy()
    }
  })
})
