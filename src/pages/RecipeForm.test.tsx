import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecipeForm from './RecipeForm'
import { renderPage, currentPath, imageFile } from '../test/renderPage'
import { seed, rows, functionsInvoke, failOn, storageUpload } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // No tags guessed by default, so typing a title stays inert unless a test
  // opts in.
  functionsInvoke.mockResolvedValue({ data: { tags: [] }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

function renderNew(state?: unknown) {
  return renderPage(<RecipeForm />, { path: '/recipes/new', route: '/recipes/new', state })
}

async function renderEdit() {
  renderPage(<RecipeForm />, { path: '/recipes/:id/edit', route: '/recipes/r1/edit' })
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
}

function seedRecipe() {
  seed('recipes', [
    {
      id: 'r1',
      title: 'Chili',
      category: 'Große Mahlzeit',
      portions: 4,
      instructions: '1. Anbraten.',
      photo_url: 'https://cdn.test/old.jpg',
      tags: ['Vegan'],
    },
  ])
  seed('recipe_ingredients', [
    { id: 'i1', recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400 },
  ])
}

describe('RecipeForm — creating', () => {
  it('starts blank with one ingredient row', () => {
    renderNew()
    expect(screen.getByRole('heading', { name: 'Neues Rezept' })).toBeInTheDocument()
    expect(screen.getByLabelText('Titel')).toHaveValue('')
    expect(screen.getAllByLabelText('Zutat')).toHaveLength(1)
  })

  it('cannot be saved without a title', async () => {
    renderNew()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('saves a minimal recipe and opens it', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), '  Pfannkuchen  ')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')).toHaveLength(1))
    expect(rows('recipes')[0]).toMatchObject({
      title: 'Pfannkuchen',
      category: null,
      portions: null,
      instructions: '',
      photo_url: null,
    })
    await waitFor(() => expect(currentPath()).toBe(`/recipes/${rows('recipes')[0].id}`))
    expect(await screen.findByRole('status')).toHaveTextContent('Pfannkuchen gespeichert')
  })

  it('saves category, portions, instructions and ingredients', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.selectOptions(screen.getByLabelText('Kategorie'), 'Große Mahlzeit')
    await user.type(screen.getByLabelText('Portionen'), '4')
    await user.type(screen.getByLabelText('Zubereitung'), '1. Anbraten.')
    await user.type(screen.getByLabelText('Zutat'), 'Bohnen')
    await user.type(screen.getByLabelText('Menge'), '2')
    await user.selectOptions(screen.getByLabelText('Einheit'), 'Dose')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')).toHaveLength(1))
    expect(rows('recipes')[0]).toMatchObject({ category: 'Große Mahlzeit', portions: 4, instructions: '1. Anbraten.' })
    expect(rows('recipe_ingredients')[0]).toMatchObject({ name: 'Bohnen', quantity: 2, unit: 'Dose' })
  })

  it('adds and removes ingredient rows', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: '+ Zutat hinzufügen' }))
    expect(screen.getAllByLabelText('Zutat')).toHaveLength(2)

    await user.click(screen.getAllByRole('button', { name: 'Zutat entfernen' })[0])
    expect(screen.getAllByLabelText('Zutat')).toHaveLength(1)
  })

  // A blank row the user never touched must not block the save.
  it('ignores ingredient rows with no name', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.click(screen.getByRole('button', { name: '+ Zutat hinzufügen' }))
    await user.type(screen.getAllByLabelText('Zutat')[0], 'Bohnen')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipe_ingredients')).toHaveLength(1))
  })

  it('accepts a comma as the decimal separator', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Öl')
    await user.type(screen.getByLabelText('Menge'), '1,5')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipe_ingredients')[0].quantity).toBe(1.5))
  })

  it('blocks the save and flags an unparseable quantity', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Öl')
    await user.type(screen.getByLabelText('Menge'), 'viel')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Bitte die markierten Mengenangaben korrigieren')
    expect(screen.getByText(/Ungültige Menge/)).toBeInTheDocument()
    expect(rows('recipes')).toHaveLength(0)
  })

  it('clears the flag once the value is corrected', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Öl')
    await user.type(screen.getByLabelText('Menge'), 'viel')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(await screen.findByText(/Ungültige Menge/)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Menge'))
    await user.type(screen.getByLabelText('Menge'), '2')
    expect(screen.queryByText(/Ungültige Menge/)).not.toBeInTheDocument()
  })

  it('asks for a grams-per-unit estimate only for container units', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Zutat'), 'Bohnen')
    expect(screen.queryByLabelText(/Gramm pro/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Einheit'), 'Dose')
    expect(screen.getByLabelText('Gramm pro Dose')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Einheit'), 'g')
    expect(screen.queryByLabelText(/Gramm pro/)).not.toBeInTheDocument()
  })

  it('saves the grams-per-unit factor', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Bohnen')
    await user.selectOptions(screen.getByLabelText('Einheit'), 'Dose')
    await user.type(screen.getByLabelText('Gramm pro Dose'), '400')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipe_ingredients')[0].grams_per_unit).toBe(400))
  })

  it('reports a failed save and stays on the form', async () => {
    failOn('recipes', 'insert')
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Fehler beim Speichern')
    expect(currentPath()).toBe('/recipes/new')
  })

  it('uploads a photo and stores its public URL', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.upload(screen.getByLabelText('Foto (optional)'), imageFile())
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(storageUpload).toHaveBeenCalled())
    expect(rows('recipes')[0].photo_url).toBe('https://cdn.test/uploaded/path.jpg')
  })

  it('saves without a photo when the upload fails', async () => {
    storageUpload.mockResolvedValue({ data: null, error: { message: 'nope' } })
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.upload(screen.getByLabelText('Foto (optional)'), imageFile())
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')).toHaveLength(1))
    expect(rows('recipes')[0].photo_url).toBeNull()
  })
})

describe('RecipeForm — tags', () => {
  it('selects and deselects a tag', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('replaces the choice within a single-select group', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    await user.click(screen.getByRole('button', { name: 'Fleisch' }))

    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Fleisch' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps several tags from a multi-select group', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: 'Günstig' }))
    await user.click(screen.getByRole('button', { name: 'Scharf' }))

    expect(screen.getByRole('button', { name: 'Günstig' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Scharf' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes a tag from the selected-tag chips', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    await user.click(screen.getByRole('button', { name: 'Tag Vegan entfernen' }))
    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('guesses tags from a typed title', async () => {
    functionsInvoke.mockResolvedValue({ data: { tags: ['Vegan', 'Scharf'] }, error: null })
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili sin Carne')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'true'))
    expect(functionsInvoke).toHaveBeenCalledWith('guess-recipe-tags', { body: { title: 'Chili sin Carne' } })
  })

  it('does not guess for a title shorter than three characters', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Ei')
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  // Guessing must never overwrite a choice the user already made.
  it('does not guess once a tag is already selected', async () => {
    const user = setup()
    renderNew()

    await user.click(screen.getByRole('button', { name: 'Vegan' }))
    await user.type(screen.getByLabelText('Titel'), 'Chili sin Carne')
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('shows progress while guessing', async () => {
    let resolve: (value: any) => void = () => {}
    functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(await screen.findByText('wird vorgeschlagen...')).toBeInTheDocument()
    resolve({ data: { tags: [] }, error: null })
    await waitFor(() => expect(screen.queryByText('wird vorgeschlagen...')).not.toBeInTheDocument())
  })
})

describe('RecipeForm — prefilled from a screenshot', () => {
  it('fills every field the parser produced', async () => {
    renderNew({
      title: 'Chili sin Carne',
      category: 'Große Mahlzeit',
      portions: 4,
      instructions: '1. Anbraten.',
      tags: ['Vegan'],
      ingredients: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400 }],
    })

    expect(screen.getByLabelText('Titel')).toHaveValue('Chili sin Carne')
    expect(screen.getByLabelText('Kategorie')).toHaveValue('Große Mahlzeit')
    expect(screen.getByLabelText('Portionen')).toHaveValue(4)
    expect(screen.getByLabelText('Zubereitung')).toHaveValue('1. Anbraten.')
    expect(screen.getByLabelText('Zutat')).toHaveValue('Bohnen')
    expect(screen.getByLabelText('Gramm pro Dose')).toHaveValue('400')
    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves quantity-less prefilled ingredients blank', async () => {
    renderNew({ title: 'X', ingredients: [{ name: 'Salz', quantity: null, unit: null }] })
    expect(screen.getByLabelText('Menge')).toHaveValue('')
    expect(screen.getByLabelText('Einheit')).toHaveValue('')
  })

  it('ignores an empty prefill', async () => {
    renderNew({})
    expect(screen.getByLabelText('Titel')).toHaveValue('')
  })
})

describe('RecipeForm — editing', () => {
  beforeEach(() => {
    seedRecipe()
  })

  it('shows a loading state, then the existing values', async () => {
    renderPage(<RecipeForm />, { path: '/recipes/:id/edit', route: '/recipes/r1/edit' })
    expect(screen.getByText('Lädt...')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue('Chili'))
    expect(screen.getByRole('heading', { name: 'Rezept bearbeiten' })).toBeInTheDocument()
    expect(screen.getByLabelText('Portionen')).toHaveValue(4)
    expect(screen.getByLabelText('Zutat')).toHaveValue('Bohnen')
    expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the existing photo', async () => {
    await renderEdit()
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/old.jpg')
  })

  it('links back to the recipe rather than the list', async () => {
    await renderEdit()
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/recipes/r1')
  })

  it('updates the recipe and returns to it', async () => {
    const user = setup()
    await renderEdit()

    await user.clear(screen.getByLabelText('Titel'))
    await user.type(screen.getByLabelText('Titel'), 'Chili con Tofu')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')[0].title).toBe('Chili con Tofu'))
    expect(await screen.findByRole('status')).toHaveTextContent('Chili con Tofu aktualisiert')
    expect(currentPath()).toBe('/recipes/r1')
  })

  // The ingredient set is replaced wholesale rather than diffed.
  it('replaces the whole ingredient set', async () => {
    const user = setup()
    await renderEdit()

    await user.clear(screen.getByLabelText('Zutat'))
    await user.type(screen.getByLabelText('Zutat'), 'Linsen')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipe_ingredients')).toHaveLength(1))
    expect(rows('recipe_ingredients')[0]).toMatchObject({ name: 'Linsen', recipe_id: 'r1' })
  })

  it('leaves no ingredients behind when they are all removed', async () => {
    const user = setup()
    await renderEdit()

    await user.clear(screen.getByLabelText('Zutat'))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipe_ingredients')).toHaveLength(0))
  })

  it('keeps the existing photo when none is picked', async () => {
    const user = setup()
    await renderEdit()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(rows('recipes')[0].photo_url).toBe('https://cdn.test/old.jpg'))
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('reports a failed update', async () => {
    failOn('recipes', 'update')
    const user = setup()
    await renderEdit()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Fehler beim Speichern')
    expect(currentPath()).toBe('/recipes/r1/edit')
  })

  it('does not guess tags for an already-tagged recipe', async () => {
    await renderEdit()
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('keeps one blank row when the recipe has no ingredients', async () => {
    rows('recipe_ingredients').length = 0
    await renderEdit()
    expect(screen.getAllByLabelText('Zutat')).toHaveLength(1)
    expect(screen.getByLabelText('Zutat')).toHaveValue('')
  })
})

describe('RecipeForm — background nutrition estimate', () => {
  it('estimates nutrition after saving a recipe with ingredients', async () => {
    functionsInvoke.mockImplementation(async (name: string) => {
      if (name === 'guess-recipe-tags') return { data: { tags: [] }, error: null }
      return { data: { kcal: 500, protein_g: 20, fat_g: 10, carbs_g: 60 }, error: null }
    })
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Bohnen')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')[0].kcal_per_portion).toBe(500))
  })

  it('skips the estimate when the recipe has no ingredients', async () => {
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')).toHaveLength(1))
    expect(functionsInvoke.mock.calls.filter(([name]) => name === 'estimate-nutrition')).toHaveLength(0)
  })

  it('leaves the recipe untouched when the estimate fails', async () => {
    functionsInvoke.mockImplementation(async (name: string) => {
      if (name === 'guess-recipe-tags') return { data: { tags: [] }, error: null }
      return { data: null, error: { message: 'boom' } }
    })
    const user = setup()
    renderNew()

    await user.type(screen.getByLabelText('Titel'), 'Chili')
    await user.type(screen.getByLabelText('Zutat'), 'Bohnen')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('recipes')).toHaveLength(1))
    expect(rows('recipes')[0].kcal_per_portion).toBeUndefined()
  })
})
