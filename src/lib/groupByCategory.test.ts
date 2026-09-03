import { describe, it, expect } from 'vitest'
import { groupByCategory } from './groupByCategory'

interface Item {
  name: string
  category: string | null
}

const ORDER = ['Obst & Gemüse', 'Milchprodukte & Eier', 'Getränke']

const get = (item: Item) => item.category

describe('groupByCategory', () => {
  it('returns nothing for an empty list', () => {
    expect(groupByCategory([], get, ORDER)).toEqual([])
  })

  it('orders groups by the given category order, not alphabetically', () => {
    const items: Item[] = [
      { name: 'Cola', category: 'Getränke' },
      { name: 'Milch', category: 'Milchprodukte & Eier' },
      { name: 'Apfel', category: 'Obst & Gemüse' },
    ]
    expect(groupByCategory(items, get, ORDER).map(([label]) => label)).toEqual([
      'Obst & Gemüse',
      'Milchprodukte & Eier',
      'Getränke',
    ])
  })

  it('keeps the caller’s order within each group', () => {
    const items: Item[] = [
      { name: 'Banane', category: 'Obst & Gemüse' },
      { name: 'Apfel', category: 'Obst & Gemüse' },
    ]
    const [[, group]] = groupByCategory(items, get, ORDER)
    expect(group.map((item) => item.name)).toEqual(['Banane', 'Apfel'])
  })

  it('sends null and unknown categories to the end under one label', () => {
    const items: Item[] = [
      { name: 'Rätsel', category: null },
      { name: 'Cola', category: 'Getränke' },
      { name: 'Sonstiges', category: 'Nicht in der Reihenfolge' },
    ]
    const groups = groupByCategory(items, get, ORDER)
    expect(groups.map(([label]) => label)).toEqual(['Getränke', 'Ohne Kategorie', 'Nicht in der Reihenfolge'])
  })

  it('accepts a custom label for uncategorized items', () => {
    const groups = groupByCategory([{ name: 'X', category: null }], get, ORDER, 'Rest')
    expect(groups).toEqual([['Rest', [{ name: 'X', category: null }]]])
  })

  it('treats an empty-string category as uncategorized', () => {
    const groups = groupByCategory([{ name: 'X', category: '' }], get, ORDER)
    expect(groups.map(([label]) => label)).toEqual(['Ohne Kategorie'])
  })

  it('does not mutate the input array', () => {
    const items: Item[] = [
      { name: 'Cola', category: 'Getränke' },
      { name: 'Apfel', category: 'Obst & Gemüse' },
    ]
    const snapshot = items.map((item) => item.name)
    groupByCategory(items, get, ORDER)
    expect(items.map((item) => item.name)).toEqual(snapshot)
  })
})
