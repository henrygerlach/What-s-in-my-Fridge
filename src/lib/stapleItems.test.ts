import { describe, it, expect, vi } from 'vitest'
import { getStapleItems, addStapleItem, removeStapleItem, getMissingStaples } from './stapleItems'
import { seed, rows } from '../test/fakeSupabase'
import type { StapleItem } from '../types'

vi.mock('./supabase')

describe('getStapleItems', () => {
  it('returns an empty list when none exist', async () => {
    expect(await getStapleItems()).toEqual([])
  })

  it('returns staples sorted by name', async () => {
    seed('staple_items', [{ name: 'Zucker' }, { name: 'Butter' }, { name: 'Mehl' }])
    expect((await getStapleItems()).map((staple) => staple.name)).toEqual(['Butter', 'Mehl', 'Zucker'])
  })
})

describe('addStapleItem', () => {
  it('ignores a blank name', async () => {
    await addStapleItem('   ')
    expect(rows('staple_items')).toHaveLength(0)
  })

  it('inserts the trimmed name', async () => {
    await addStapleItem('  Mehl ')
    expect(rows('staple_items')[0].name).toBe('Mehl')
  })

  it('does not add a duplicate, ignoring case', async () => {
    seed('staple_items', [{ name: 'Mehl' }])
    await addStapleItem('mehl')
    expect(rows('staple_items')).toHaveLength(1)
  })
})

describe('removeStapleItem', () => {
  it('deletes only the given staple', async () => {
    seed('staple_items', [
      { id: 'a', name: 'Mehl' },
      { id: 'b', name: 'Zucker' },
    ])
    await removeStapleItem('a')
    expect(rows('staple_items').map((staple) => staple.name)).toEqual(['Zucker'])
  })
})

describe('getMissingStaples', () => {
  const staples = [
    { id: 's1', name: 'Mehl' },
    { id: 's2', name: 'Milch' },
  ] as StapleItem[]

  it('reports every staple as missing when nothing is in stock or listed', () => {
    expect(getMissingStaples(staples, [], []).map((staple) => staple.name)).toEqual(['Mehl', 'Milch'])
  })

  it('does not report a staple that is in stock', () => {
    expect(getMissingStaples(staples, [{ name: 'Mehl' }], []).map((staple) => staple.name)).toEqual(['Milch'])
  })

  it('does not report a staple already on the shopping list', () => {
    expect(getMissingStaples(staples, [], [{ name: 'Milch' }]).map((staple) => staple.name)).toEqual(['Mehl'])
  })

  // Staples reuse the same word-boundary matcher, so a compound word must not
  // mark the staple as covered.
  it('is not satisfied by a different compound-word product', () => {
    expect(getMissingStaples(staples, [{ name: 'Kokosmilch' }], []).map((staple) => staple.name)).toEqual([
      'Mehl',
      'Milch',
    ])
  })

  it('ignores quantity entirely — any amount counts as having it', () => {
    expect(getMissingStaples([staples[0]], [{ name: 'Mehl' }], [])).toEqual([])
  })
})
