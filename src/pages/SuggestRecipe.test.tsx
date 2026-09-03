import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SuggestRecipe from './SuggestRecipe'
import { renderPage, currentPath } from '../test/renderPage'
import { seed, rows, functionsInvoke, failOn } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

const suggestion = {
  title: 'Chili sin Carne',
  category: 'Große Mahlzeit',
  portions: 4,
  description: 'Herzhaft und schnell',
  instructions: '1. Anbraten.',
  ingredients: [
    { name: 'Bohnen', quantity: 1, unit: 'Dose' },
    { name: 'Tomaten', quantity: 400, unit: 'g' },
  ],
}

beforeEach(() => {
  functionsInvoke.mockResolvedValue({ data: { suggestions: [suggestion] }, error: null })
})

async function ask(prompt = 'etwas mit Bohnen') {
  const user = userEvent.setup()
  renderPage(<SuggestRecipe />)
  await user.type(screen.getByLabelText('Was möchtest du kochen?'), prompt)
  await user.click(screen.getByRole('button', { name: 'Vorschläge holen' }))
  return user
}

describe('SuggestRecipe', () => {
  it('cannot be submitted with an empty or blank prompt', async () => {
    const user = userEvent.setup()
    renderPage(<SuggestRecipe />)
    expect(screen.getByRole('button', { name: 'Vorschläge holen' })).toBeDisabled()

    await user.type(screen.getByLabelText('Was möchtest du kochen?'), '   ')
    expect(screen.getByRole('button', { name: 'Vorschläge holen' })).toBeDisabled()
  })

  // The whole point of the feature: suggestions are constrained to the
  // inventory, so the inventory has to travel with the request.
  it('sends the current inventory alongside the trimmed prompt', async () => {
    seed('food_items', [{ name: 'Bohnen', quantity: 2, unit: 'Dose', location: 'pantry' }])
    await ask('  etwas mit Bohnen  ')

    await waitFor(() => expect(functionsInvoke).toHaveBeenCalled())
    expect(functionsInvoke).toHaveBeenCalledWith('suggest-recipes', {
      body: {
        inventory: [{ name: 'Bohnen', quantity: 2, unit: 'Dose' }],
        prompt: 'etwas mit Bohnen',
      },
    })
  })

  it('shows progress while suggestions are loading', async () => {
    let resolve: (value: any) => void = () => {}
    functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
    await ask()

    expect(await screen.findByRole('button', { name: 'Lädt Vorschläge...' })).toBeDisabled()
    resolve({ data: { suggestions: [] }, error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vorschläge holen' })).toBeInTheDocument())
  })

  it('renders a suggestion with its category, description and portions', async () => {
    await ask()
    expect(await screen.findByRole('heading', { name: 'Chili sin Carne' })).toBeInTheDocument()
    expect(screen.getByText('Große Mahlzeit')).toBeInTheDocument()
    expect(screen.getByText('Herzhaft und schnell')).toBeInTheDocument()
    expect(screen.getByText('Für 4 Portionen')).toBeInTheDocument()
  })

  it('omits the category and portions when the model gave none', async () => {
    functionsInvoke.mockResolvedValue({
      data: { suggestions: [{ ...suggestion, category: null, portions: null }] },
      error: null,
    })
    await ask()
    await screen.findByRole('heading', { name: 'Chili sin Carne' })
    expect(screen.queryByText(/Portionen/)).not.toBeInTheDocument()
  })

  it('lists each ingredient with its amount', async () => {
    await ask()
    expect(await screen.findByText('Bohnen')).toBeInTheDocument()
    expect(screen.getByText('1 Dose')).toBeInTheDocument()
    expect(screen.getByText('400 g')).toBeInTheDocument()
  })

  it('omits the amount for a quantity-less ingredient', async () => {
    functionsInvoke.mockResolvedValue({
      data: { suggestions: [{ ...suggestion, ingredients: [{ name: 'Salz', quantity: null, unit: null }] }] },
      error: null,
    })
    await ask()
    const list = (await screen.findByText('Salz')).closest('ul') as HTMLElement
    expect(within(list).queryByText(/\d/)).not.toBeInTheDocument()
  })

  // The meter is what tells the user whether the suggestion is actually
  // cookable right now, so it has to be computed against real stock.
  it('scores the suggestion against what is actually in stock', async () => {
    seed('food_items', [{ name: 'Bohnen', quantity: 2, unit: 'Dose', location: 'pantry' }])
    await ask()
    expect(await screen.findByRole('img', { name: '1 von 2 Zutaten vorhanden' })).toBeInTheDocument()
  })

  it('scores nothing as available when the pantry is empty', async () => {
    await ask()
    expect(await screen.findByRole('img', { name: '0 von 2 Zutaten vorhanden' })).toBeInTheDocument()
  })

  it('reports an inventory read failure without calling the model', async () => {
    failOn('food_items', 'select')
    await ask()
    expect(await screen.findByText('Inventar konnte nicht geladen werden.')).toBeInTheDocument()
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('reports a failed suggestion call', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await ask()
    expect(await screen.findByText('Rezeptvorschläge konnten nicht geladen werden.')).toBeInTheDocument()
  })

  it('reports a reply with no suggestions field', async () => {
    functionsInvoke.mockResolvedValue({ data: {}, error: null })
    await ask()
    expect(await screen.findByText('Rezeptvorschläge konnten nicht geladen werden.')).toBeInTheDocument()
  })

  describe('saving a suggestion', () => {
    it('writes the recipe and its ingredients, then opens it', async () => {
      const user = await ask()
      await user.click(await screen.findByRole('button', { name: 'Als Rezept speichern' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipes')[0]).toMatchObject({
        title: 'Chili sin Carne',
        instructions: '1. Anbraten.',
        category: 'Große Mahlzeit',
        portions: 4,
        photo_url: null,
      })
      expect(rows('recipe_ingredients')).toHaveLength(2)
      expect(rows('recipe_ingredients')[0]).toMatchObject({ name: 'Bohnen', quantity: 1, unit: 'Dose' })

      await waitFor(() => expect(currentPath()).toBe(`/recipes/${rows('recipes')[0].id}`))
    })

    it('confirms the save with a toast', async () => {
      const user = await ask()
      await user.click(await screen.findByRole('button', { name: 'Als Rezept speichern' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Chili sin Carne gespeichert')
    })

    it('skips the ingredient write for a recipe with none', async () => {
      functionsInvoke.mockResolvedValue({ data: { suggestions: [{ ...suggestion, ingredients: [] }] }, error: null })
      const user = await ask()
      await user.click(await screen.findByRole('button', { name: 'Als Rezept speichern' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipe_ingredients')).toHaveLength(0)
    })

    it('reports a failed save and stays on the page', async () => {
      failOn('recipes', 'insert')
      const user = await ask()
      await user.click(await screen.findByRole('button', { name: 'Als Rezept speichern' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Fehler beim Speichern')
      expect(currentPath()).toBe('/')
      expect(rows('recipe_ingredients')).toHaveLength(0)
    })

    it('saves only the suggestion whose button was pressed', async () => {
      functionsInvoke.mockResolvedValue({
        data: { suggestions: [suggestion, { ...suggestion, title: 'Linsensuppe' }] },
        error: null,
      })
      const user = await ask()

      const buttons = await screen.findAllByRole('button', { name: 'Als Rezept speichern' })
      expect(buttons).toHaveLength(2)

      await user.click(buttons[1])
      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipes')[0].title).toBe('Linsensuppe')
    })

    it('renders one card per suggestion', async () => {
      functionsInvoke.mockResolvedValue({
        data: { suggestions: [suggestion, { ...suggestion, title: 'Linsensuppe' }] },
        error: null,
      })
      await ask()
      expect(await screen.findByRole('heading', { name: 'Chili sin Carne' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Linsensuppe' })).toBeInTheDocument()
    })

    it('marks in-stock ingredients apart from missing ones', async () => {
      seed('food_items', [{ name: 'Bohnen', quantity: 2, unit: 'Dose', location: 'pantry' }])
      await ask()
      const list = (await screen.findByText('Bohnen')).closest('ul') as HTMLElement
      expect(within(list).getByText('Bohnen').className).toContain('text-ink')
      expect(within(list).getByText('Tomaten').className).toContain('text-ink-faint')
    })
  })
})
