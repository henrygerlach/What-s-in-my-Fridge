import { describe, it, expect, vi } from 'vitest'
import { classifyItem, classifyItems } from './classify'
import { functionsInvoke } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('classifyItem', () => {
  it('returns null for a blank name without calling the function', async () => {
    expect(await classifyItem('   ')).toBeNull()
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('sends the trimmed name and maps the reply', async () => {
    functionsInvoke.mockResolvedValue({ data: { category: 'Getränke', location: 'pantry' }, error: null })
    expect(await classifyItem('  Cola ')).toEqual({ category: 'Getränke', location: 'pantry' })
    expect(functionsInvoke).toHaveBeenCalledWith('classify-item', { body: { name: 'Cola' } })
  })

  it('defaults a missing category to empty and a missing location to the fridge', async () => {
    functionsInvoke.mockResolvedValue({ data: {}, error: null })
    expect(await classifyItem('Cola')).toEqual({ category: '', location: 'fridge' })
  })

  it('returns null when the function errors or returns nothing', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await classifyItem('Cola')).toBeNull()

    functionsInvoke.mockResolvedValue({ data: null, error: null })
    expect(await classifyItem('Cola')).toBeNull()
  })
})

describe('classifyItems', () => {
  it('returns an empty map for no usable names, without calling the function', async () => {
    expect(await classifyItems([])).toEqual(new Map())
    expect(await classifyItems(['  ', ''])).toEqual(new Map())
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('classifies a batch in one call, keyed by trimmed name', async () => {
    functionsInvoke.mockResolvedValue({ data: { categories: ['Getränke', 'Obst & Gemüse'] }, error: null })
    const result = await classifyItems([' Cola', 'Apfel '])
    expect(functionsInvoke).toHaveBeenCalledTimes(1)
    expect(functionsInvoke).toHaveBeenCalledWith('classify-items', { body: { names: ['Cola', 'Apfel'] } })
    expect(result.get('Cola')).toBe('Getränke')
    expect(result.get('Apfel')).toBe('Obst & Gemüse')
  })

  it('fills in an empty category when the reply is shorter than the request', async () => {
    functionsInvoke.mockResolvedValue({ data: { categories: ['Getränke'] }, error: null })
    const result = await classifyItems(['Cola', 'Apfel'])
    expect(result.get('Apfel')).toBe('')
  })

  it('falls back to an empty map rather than blocking the caller', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await classifyItems(['Cola'])).toEqual(new Map())

    functionsInvoke.mockResolvedValue({ data: { categories: 'not an array' }, error: null })
    expect(await classifyItems(['Cola'])).toEqual(new Map())
  })
})
