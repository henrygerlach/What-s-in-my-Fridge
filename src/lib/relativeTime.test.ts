import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const NOW = new Date('2026-06-15T12:00:00.000Z')

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says "gerade eben" under a minute', () => {
    expect(formatRelativeTime(ago(0))).toBe('gerade eben')
    expect(formatRelativeTime(ago(59_000))).toBe('gerade eben')
  })

  it('counts minutes up to an hour', () => {
    expect(formatRelativeTime(ago(MINUTE))).toBe('vor 1 Min.')
    expect(formatRelativeTime(ago(59 * MINUTE))).toBe('vor 59 Min.')
  })

  it('counts hours up to a day', () => {
    expect(formatRelativeTime(ago(HOUR))).toBe('vor 1 Std.')
    expect(formatRelativeTime(ago(23 * HOUR))).toBe('vor 23 Std.')
  })

  it('uses "gestern" for exactly one day', () => {
    expect(formatRelativeTime(ago(DAY))).toBe('gestern')
  })

  it('counts days up to a week', () => {
    expect(formatRelativeTime(ago(2 * DAY))).toBe('vor 2 Tagen')
    expect(formatRelativeTime(ago(6 * DAY))).toBe('vor 6 Tagen')
  })

  it('switches to weeks, singular and plural', () => {
    expect(formatRelativeTime(ago(7 * DAY))).toBe('vor 1 Woche')
    expect(formatRelativeTime(ago(14 * DAY))).toBe('vor 2 Wochen')
    expect(formatRelativeTime(ago(28 * DAY))).toBe('vor 4 Wochen')
  })

  it('switches to months, singular and plural', () => {
    expect(formatRelativeTime(ago(35 * DAY))).toBe('vor 1 Monat')
    expect(formatRelativeTime(ago(90 * DAY))).toBe('vor 3 Monaten')
    expect(formatRelativeTime(ago(360 * DAY))).toBe('vor 12 Monaten')
  })

  it('switches to years, singular and plural', () => {
    expect(formatRelativeTime(ago(365 * DAY))).toBe('vor 1 Jahr')
    expect(formatRelativeTime(ago(800 * DAY))).toBe('vor 2 Jahren')
  })
})
