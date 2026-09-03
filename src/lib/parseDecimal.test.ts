import { describe, it, expect } from 'vitest'
import { parseDecimal } from './parseDecimal'

describe('parseDecimal', () => {
  it('treats a blank input as "no quantity given", which is valid', () => {
    expect(parseDecimal('')).toEqual({ value: null, valid: true })
    expect(parseDecimal('   ')).toEqual({ value: null, valid: true })
  })

  it('parses a plain number', () => {
    expect(parseDecimal('400')).toEqual({ value: 400, valid: true })
    expect(parseDecimal(' 2.5 ')).toEqual({ value: 2.5, valid: true })
  })

  // German keyboards produce a comma; silently dropping it would turn 1,5 kg
  // into 15 kg.
  it('accepts a comma as the decimal separator', () => {
    expect(parseDecimal('1,5')).toEqual({ value: 1.5, valid: true })
    expect(parseDecimal('0,25')).toEqual({ value: 0.25, valid: true })
  })

  it('flags non-numeric input instead of silently saving null', () => {
    expect(parseDecimal('abc')).toEqual({ value: null, valid: false })
    expect(parseDecimal('1,2,3')).toEqual({ value: null, valid: false })
    expect(parseDecimal('--5')).toEqual({ value: null, valid: false })
  })

  it('parses negative and exponent-free edge values', () => {
    expect(parseDecimal('-3')).toEqual({ value: -3, valid: true })
    expect(parseDecimal('0')).toEqual({ value: 0, valid: true })
  })
})
