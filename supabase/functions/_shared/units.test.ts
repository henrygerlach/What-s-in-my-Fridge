import { describe, it, expect } from 'vitest'
import {
  UNIT_OPTIONS,
  CONTAINER_UNITS,
  UNIT_CONVERSION_PROMPT,
  GRAMS_PER_UNIT_PROMPT,
  normalizeUnit,
  normalizeGramsPerUnit,
} from './units.ts'

describe('unit vocabulary', () => {
  it('contains no spoon or cup units — those are converted to ml instead', () => {
    for (const ambiguous of ['EL', 'TL', 'Tasse']) {
      expect(UNIT_OPTIONS).not.toContain(ambiguous)
    }
  })

  it('lists container units as a subset of the allowed units', () => {
    for (const unit of CONTAINER_UNITS) {
      expect(UNIT_OPTIONS).toContain(unit)
    }
  })

  it('excludes exact measures from the container units', () => {
    for (const exact of ['g', 'kg', 'ml', 'l']) {
      expect(CONTAINER_UNITS).not.toContain(exact)
    }
  })
})

describe('prompt fragments', () => {
  it('spells out the spoon-to-millilitre conversions', () => {
    expect(UNIT_CONVERSION_PROMPT).toContain('15 ml')
    expect(UNIT_CONVERSION_PROMPT).toContain('5 ml')
    expect(UNIT_CONVERSION_PROMPT).toContain('240 ml')
  })

  it('lists every allowed unit for the model', () => {
    for (const unit of UNIT_OPTIONS) {
      expect(UNIT_CONVERSION_PROMPT).toContain(`"${unit}"`)
    }
  })

  it('asks for a grams estimate only for container units', () => {
    for (const unit of CONTAINER_UNITS) {
      expect(GRAMS_PER_UNIT_PROMPT).toContain(`"${unit}"`)
    }
    expect(GRAMS_PER_UNIT_PROMPT).toContain('grams_per_unit')
  })
})

describe('normalizeUnit', () => {
  it('keeps a unit the app knows', () => {
    for (const unit of UNIT_OPTIONS) {
      expect(normalizeUnit(unit)).toBe(unit)
    }
  })

  // An invented unit would flow into stock comparisons and silently break
  // them, so anything unrecognised becomes "no unit".
  it('rejects anything outside the vocabulary', () => {
    expect(normalizeUnit('EL')).toBeNull()
    expect(normalizeUnit('Handvoll')).toBeNull()
    expect(normalizeUnit('G')).toBeNull()
  })

  it('treats null, undefined and empty as no unit', () => {
    expect(normalizeUnit(null)).toBeNull()
    expect(normalizeUnit(undefined)).toBeNull()
    expect(normalizeUnit('')).toBeNull()
  })
})

describe('normalizeGramsPerUnit', () => {
  it('keeps a positive number', () => {
    expect(normalizeGramsPerUnit(400)).toBe(400)
    expect(normalizeGramsPerUnit(0.5)).toBe(0.5)
  })

  it('rejects zero, negatives and non-numbers', () => {
    for (const invalid of [0, -1, '400', null, undefined, NaN, {}]) {
      expect(normalizeGramsPerUnit(invalid)).toBeNull()
    }
  })
})
