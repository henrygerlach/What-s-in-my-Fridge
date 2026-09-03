import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeDetail from './RecipeDetail'
import { renderPage, currentPath } from '../test/renderPage'
import { seed, rows, functionsInvoke, emitRealtimeChange } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

beforeEach(() => {
  functionsInvoke.mockResolvedValue({ data: { categories: [] }, error: null })
})

function seedRecipe(overrides: Record<string, unknown> = {}) {
  seed('recipes', [
    {
      id: 'r1',
      title: 'Chili sin Carne',
      category: 'Große Mahlzeit',
      tags: ['Vegan'],
      portions: 2,
      instructions: '1. 2 Zwiebeln anbraten.\n2. Alles köcheln.',
      photo_url: null,
      kcal_per_portion: null,
      protein_g_per_portion: null,
      fat_g_per_portion: null,
      carbs_g_per_portion: null,
      ...overrides,
    },
  ])
}

function seedIngredients() {
  seed('recipe_ingredients', [
    { id: 'i1', recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400 },
    { id: 'i2', recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g', grams_per_unit: null },
  ])
}

async function renderDetail() {
  const user = userEvent.setup()
  renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return user
}

// The live portion count sits between the two adjust buttons and carries no
// label of its own.
function portionCount(): string {
  return screen.getByRole('button', { name: 'Mehr Portionen' }).previousElementSibling?.textContent ?? ''
}

function ingredientRow(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('RecipeDetail', () => {
  it('shows a loading state first', () => {
    renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('reports a recipe that does not exist', async () => {
    renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/missing' })
    expect(await screen.findByText('Rezept nicht gefunden.')).toBeInTheDocument()
  })

  it('shows the title, category and tags', async () => {
    seedRecipe()
    await renderDetail()
    expect(screen.getByRole('heading', { name: 'Chili sin Carne' })).toBeInTheDocument()
    expect(screen.getByText('Große Mahlzeit')).toBeInTheDocument()
    expect(screen.getByText('Vegan')).toBeInTheDocument()
  })

  it('shows the photo when there is one', async () => {
    seedRecipe({ photo_url: 'https://cdn.test/chili.jpg' })
    await renderDetail()
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/chili.jpg')
  })

  it('renders the instructions as numbered steps with the numbering stripped', async () => {
    seedRecipe()
    await renderDetail()
    const steps = screen.getAllByRole('listitem').filter((item) => item.closest('ol'))
    expect(steps).toHaveLength(2)
    expect(steps[0]).toHaveTextContent('2 Zwiebeln anbraten.')
    expect(steps[0].textContent).not.toContain('1. 1.')
  })

  describe('ingredient availability', () => {
    it('marks which ingredients are in stock', async () => {
      seedRecipe()
      seedIngredients()
      seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
      await renderDetail()

      expect(screen.getByRole('img', { name: '1 von 2 Zutaten vorhanden' })).toBeInTheDocument()
      expect(screen.getByText('Tomaten').className).toContain('text-ink')
      expect(screen.getByText('Bohnen').className).toContain('text-ink-faint')
    })

    it('offers to add a missing ingredient to the list', async () => {
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(within(ingredientRow('Bohnen')).getByRole('button', { name: '+ Liste' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Bohnen zur Einkaufsliste hinzugefügt')
      await waitFor(() => expect(rows('shopping_list_items')[0].name).toBe('Bohnen'))
    })

    it('says when a missing ingredient is already on the list', async () => {
      seedRecipe()
      seedIngredients()
      seed('shopping_list_items', [{ name: 'Bohnen', quantity: 1, unit: 'Dose', category: null }])
      await renderDetail()

      expect(within(ingredientRow('Bohnen')).getByText('schon auf der Liste')).toBeInTheDocument()
      expect(within(ingredientRow('Bohnen')).queryByRole('button', { name: '+ Liste' })).not.toBeInTheDocument()
    })

    it('adds every missing ingredient at once', async () => {
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: 'Alle fehlenden zur Einkaufsliste' }))
      expect(await screen.findByRole('status')).toHaveTextContent('2 Zutaten zur Einkaufsliste hinzugefügt')
      await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(2))
    })

    it('hides the bulk-add button once everything is in stock', async () => {
      seedRecipe()
      seedIngredients()
      seed('food_items', [
        { name: 'Tomaten', quantity: 1, unit: 'kg' },
        { name: 'Bohnen', quantity: 3, unit: 'Dose', grams_per_unit: 400 },
      ])
      await renderDetail()
      expect(screen.queryByRole('button', { name: 'Alle fehlenden zur Einkaufsliste' })).not.toBeInTheDocument()
    })
  })

  describe('scaling portions', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('starts at the recipe’s own portion count', async () => {
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
      expect(screen.getByText('Rezept für 2 Portionen')).toBeInTheDocument()
    })

    it('rescales ingredient quantities live', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      seedRecipe()
      seedIngredients()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      expect(screen.getByText('400 g')).toBeInTheDocument()
      // 2 portions -> 3 is a ratio of 1.5.
      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      expect(screen.getByText('600 g')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      expect(screen.getByText('800 g')).toBeInTheDocument()
    })

    it('never goes below one portion', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      for (let i = 0; i < 4; i += 1) {
        await user.click(screen.getByRole('button', { name: 'Weniger Portionen' }))
      }
      expect(portionCount()).toBe('1')
    })

    // The prose rewrite is a view-level transformation: it always starts from
    // the stored instructions and is never written back.
    it('rewrites the instructions for the new portion count without saving them', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      functionsInvoke.mockResolvedValue({ data: { instructions: '1. 4 Zwiebeln anbraten.' }, error: null })
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      await waitFor(() =>
        expect(functionsInvoke).toHaveBeenCalledWith('scale-recipe', {
          body: { instructions: '1. 2 Zwiebeln anbraten.\n2. Alles köcheln.', originalPortions: 2, newPortions: 3 },
        }),
      )
      await waitFor(() => expect(screen.getByText('4 Zwiebeln anbraten.')).toBeInTheDocument())
      expect(rows('recipes')[0].instructions).toBe('1. 2 Zwiebeln anbraten.\n2. Alles köcheln.')
    })

    it('always rescales from the original, not from a previous rescale', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      functionsInvoke.mockResolvedValue({ data: { instructions: 'skaliert' }, error: null })
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(700)
      })
      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(700)
      })

      const calls = functionsInvoke.mock.calls.filter(([name]) => name === 'scale-recipe')
      for (const [, options] of calls) {
        expect((options as { body: { instructions: string } }).body.instructions).toBe(
          '1. 2 Zwiebeln anbraten.\n2. Alles köcheln.',
        )
      }
    })

    it('keeps the original text when the rewrite fails', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(700)
      })
      await waitFor(() => expect(screen.getByText('2 Zwiebeln anbraten.')).toBeInTheDocument())
    })

    it('does not call the model when the portions are unchanged', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      seedRecipe()
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await user.click(screen.getByRole('button', { name: 'Weniger Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      expect(functionsInvoke.mock.calls.filter(([name]) => name === 'scale-recipe')).toHaveLength(0)
    })

    it('does not rewrite empty instructions', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      seedRecipe({ instructions: '   ' })
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
      expect(functionsInvoke.mock.calls.filter(([name]) => name === 'scale-recipe')).toHaveLength(0)
    })

    it('says when the recipe states no portion count', async () => {
      seedRecipe({ portions: null })
      renderPage(<RecipeDetail />, { path: '/recipes/:id', route: '/recipes/r1' })
      await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
      expect(screen.getByText('Portionen im Rezept nicht angegeben')).toBeInTheDocument()
    })
  })

  describe('nutrition', () => {
    it('shows stored values instead of the estimate button', async () => {
      seedRecipe({
        kcal_per_portion: 520.4,
        protein_g_per_portion: 18.6,
        fat_g_per_portion: 12.2,
        carbs_g_per_portion: 80.7,
      })
      seedIngredients()
      await renderDetail()

      expect(screen.getByText(/520 kcal/)).toBeInTheDocument()
      expect(screen.getByText(/19 g Eiweiß/)).toBeInTheDocument()
      expect(screen.getByText(/12 g Fett/)).toBeInTheDocument()
      expect(screen.getByText(/81 g KH/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Nährwerte schätzen' })).not.toBeInTheDocument()
    })

    it('offers an estimate only when there are ingredients', async () => {
      seedRecipe()
      await renderDetail()
      expect(screen.queryByRole('button', { name: 'Nährwerte schätzen' })).not.toBeInTheDocument()
    })

    it('estimates and stores the values', async () => {
      functionsInvoke.mockResolvedValue({
        data: { kcal: 520, protein_g: 18, fat_g: 12, carbs_g: 80 },
        error: null,
      })
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: 'Nährwerte schätzen' }))
      await waitFor(() => expect(screen.getByText(/520 kcal/)).toBeInTheDocument())
      expect(rows('recipes')[0]).toMatchObject({ kcal_per_portion: 520, protein_g_per_portion: 18 })
    })

    it('reports a failed estimate', async () => {
      functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: 'Nährwerte schätzen' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Nährwerte konnten nicht geschätzt werden')
    })
  })

  describe('cooking the recipe', () => {
    it('is blocked until every ingredient is in stock', async () => {
      seedRecipe()
      seedIngredients()
      await renderDetail()

      expect(screen.getByRole('button', { name: /Gekocht/ })).toBeDisabled()
      expect(screen.getByText('Erst abziehbar, wenn alle Zutaten im Inventar sind.')).toBeInTheDocument()
    })

    it('deducts the cooked amounts from stock and logs the cook', async () => {
      seedRecipe()
      seedIngredients()
      seed('food_items', [
        { id: 'f1', name: 'Tomaten', quantity: 1, unit: 'kg' },
        { id: 'f2', name: 'Bohnen', quantity: 3, unit: 'Dose', grams_per_unit: 400 },
      ])
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: /Gekocht/ }))
      await waitFor(() => expect(rows('recipe_cook_log')).toHaveLength(1))

      expect(rows('food_items').find((item) => item.id === 'f1')?.quantity).toBe(0.6)
      expect(rows('food_items').find((item) => item.id === 'f2')?.quantity).toBe(2)
      expect(rows('consumption_log').every((entry) => entry.source === 'cooked')).toBe(true)
    })

    it('deletes a stock row that the recipe uses up entirely', async () => {
      seedRecipe()
      seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ id: 'f1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: /Gekocht/ }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
    })

    it('restores the exact prior quantities on undo', async () => {
      seedRecipe()
      seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ id: 'f1', name: 'Tomaten', quantity: 1, unit: 'kg' }])
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: /Gekocht/ }))
      expect(await screen.findByRole('status')).toHaveTextContent('gekocht – Zutaten vom Bestand abgezogen')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')[0].quantity).toBe(1))
    })

    it('restores a fully-used-up row on undo', async () => {
      seedRecipe()
      seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ id: 'f1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: /Gekocht/ }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(0))

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(1))
      expect(rows('food_items')[0]).toMatchObject({ name: 'Tomaten', quantity: 400 })
    })

    it('says so when nothing well-defined can be deducted', async () => {
      seedRecipe()
      seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Salz', quantity: null, unit: null }])
      seed('food_items', [{ id: 'f1', name: 'Salz', quantity: 1, unit: 'Packung' }])
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: /Gekocht/ }))
      expect(await screen.findByRole('status')).toHaveTextContent('Kein Abzug notwendig')
      expect(rows('food_items')[0].quantity).toBe(1)
    })
  })

  describe('deleting the recipe', () => {
    it('deletes it and returns to the list', async () => {
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: 'Optionen' }))
      await user.click(screen.getByRole('button', { name: 'Löschen' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(0))
      expect(currentPath()).toBe('/recipes')
    })

    it('restores the recipe and its ingredients on undo', async () => {
      seedRecipe()
      seedIngredients()
      const user = await renderDetail()

      await user.click(screen.getByRole('button', { name: 'Optionen' }))
      await user.click(screen.getByRole('button', { name: 'Löschen' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Chili sin Carne gelöscht')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipe_ingredients')).toHaveLength(2)
      expect(currentPath()).toBe(`/recipes/${rows('recipes')[0].id}`)
    })

    it('links to the edit form', async () => {
      seedRecipe()
      const user = await renderDetail()
      await user.click(screen.getByRole('button', { name: 'Optionen' }))
      expect(screen.getByRole('link', { name: 'Bearbeiten' })).toHaveAttribute('href', '/recipes/r1/edit')
    })

    it('closes the menu when clicking outside', async () => {
      seedRecipe()
      const user = await renderDetail()
      await user.click(screen.getByRole('button', { name: 'Optionen' }))
      await user.click(document.body)
      expect(screen.queryByRole('link', { name: 'Bearbeiten' })).not.toBeInTheDocument()
    })
  })

  it('updates availability when stock changes elsewhere', async () => {
    seedRecipe()
    seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
    await renderDetail()
    expect(screen.getByRole('img', { name: '0 von 1 Zutaten vorhanden' })).toBeInTheDocument()

    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByRole('img', { name: '1 von 1 Zutaten vorhanden' })).toBeInTheDocument())
  })
})
