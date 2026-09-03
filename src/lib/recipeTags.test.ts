import { describe, it, expect, vi } from 'vitest'
import { guessRecipeTags } from './recipeTags'
import { functionsInvoke } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('guessRecipeTags', () => {
  it('returns nothing for a blank title without calling the function', async () => {
    expect(await guessRecipeTags('  ')).toEqual([])
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('sends the trimmed title and returns the tags', async () => {
    functionsInvoke.mockResolvedValue({ data: { tags: ['vegetarisch', 'schnell'] }, error: null })
    expect(await guessRecipeTags(' Chili ')).toEqual(['vegetarisch', 'schnell'])
    expect(functionsInvoke).toHaveBeenCalledWith('guess-recipe-tags', { body: { title: 'Chili' } })
  })

  it('yields no suggestions rather than throwing when the call fails', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await guessRecipeTags('Chili')).toEqual([])
  })

  it('yields no suggestions when the reply is not a tag array', async () => {
    functionsInvoke.mockResolvedValue({ data: { tags: 'vegetarisch' }, error: null })
    expect(await guessRecipeTags('Chili')).toEqual([])
  })
})
