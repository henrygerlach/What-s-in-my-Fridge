import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Recipes from './Recipes'
import { renderPage } from '../test/renderPage'
import { seed, rows, functionsInvoke, emitRealtimeChange, db } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

beforeEach(() => {
  functionsInvoke.mockResolvedValue({ data: { categories: [] }, error: null })
})

async function renderRecipes() {
  const user = userEvent.setup()
  renderPage(<Recipes />, { path: '/recipes', route: '/recipes' })
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return user
}

function recipeRow(title: string): HTMLElement {
  return screen.getByText(title).closest('li') as HTMLElement
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(recipeRow(title)).getByRole('button', { name: 'Optionen' }))
}

describe('Recipes', () => {
  it('shows a loading state first', () => {
    renderPage(<Recipes />)
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('offers a first-recipe call to action when there are none', async () => {
    await renderRecipes()
    expect(screen.getByText('Noch keine Rezepte gespeichert.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Erstes Rezept anlegen' })).toHaveAttribute('href', '/recipes/new')
  })

  it('lists recipes grouped by category', async () => {
    seed('recipes', [
      { id: 'r1', title: 'Chili', category: 'Große Mahlzeit' },
      { id: 'r2', title: 'Müsli', category: 'Frühstück' },
    ])
    await renderRecipes()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings[0]).toContain('Frühstück')
    expect(headings[1]).toContain('Große Mahlzeit')
  })

  it('links each recipe to its detail and edit routes', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    const user = await renderRecipes()

    expect(screen.getByRole('link', { name: /Chili/ })).toHaveAttribute('href', '/recipes/r1')
    await openRowMenu(user, 'Chili')
    expect(screen.getByRole('link', { name: 'Bearbeiten' })).toHaveAttribute('href', '/recipes/r1/edit')
  })

  it('shows how many ingredients are in stock', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    seed('recipe_ingredients', [
      { recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' },
      { recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' },
    ])
    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    await renderRecipes()

    expect(screen.getByRole('img', { name: '1 von 2 Zutaten vorhanden' })).toBeInTheDocument()
  })

  it('says when a recipe has never been cooked', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    await renderRecipes()
    expect(screen.getByText('Noch nie gekocht')).toBeInTheDocument()
  })

  it('shows how long ago a recipe was last cooked', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    seed('recipe_cook_log', [{ recipe_id: 'r1', cooked_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }])
    await renderRecipes()
    expect(await screen.findByText('Zuletzt gekocht vor 3 Tagen')).toBeInTheDocument()
  })

  it('shows headline nutrition per portion when known', async () => {
    seed('recipes', [
      { id: 'r1', title: 'Chili', category: 'Große Mahlzeit', kcal_per_portion: 520.4, protein_g_per_portion: 18.6 },
    ])
    await renderRecipes()
    expect(screen.getByText(/520 kcal/)).toBeInTheDocument()
    expect(screen.getByText(/19 g Eiweiß/)).toBeInTheDocument()
  })

  it('omits protein when only calories are known', async () => {
    seed('recipes', [
      { id: 'r1', title: 'Chili', category: 'Große Mahlzeit', kcal_per_portion: 520, protein_g_per_portion: null },
    ])
    await renderRecipes()
    expect(screen.getByText(/520 kcal/)).toBeInTheDocument()
    expect(screen.queryByText(/Eiweiß/)).not.toBeInTheDocument()
  })

  describe('searching and filtering', () => {
    beforeEach(() => {
      seed('recipes', [
        { id: 'r1', title: 'Chili sin Carne', category: 'Große Mahlzeit', tags: ['Vegan', 'Scharf'] },
        { id: 'r2', title: 'Rührei', category: 'Frühstück', tags: ['Vegetarisch', '< 10 Min.'] },
      ])
    })

    it('filters by title, case-insensitively', async () => {
      const user = await renderRecipes()
      await user.type(screen.getByLabelText('Rezept suchen'), 'chili')

      expect(screen.getByText('Chili sin Carne')).toBeInTheDocument()
      expect(screen.queryByText('Rührei')).not.toBeInTheDocument()
    })

    it('says when nothing matches, without offering the first-recipe link', async () => {
      const user = await renderRecipes()
      await user.type(screen.getByLabelText('Rezept suchen'), 'Pizza')

      expect(screen.getByText('Keine Rezepte gefunden.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Erstes Rezept anlegen' })).not.toBeInTheDocument()
    })

    it('offers only tags that some recipe actually carries, grouped', async () => {
      await renderRecipes()
      expect(screen.getByRole('button', { name: 'Vegan' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Fisch' })).not.toBeInTheDocument()
      expect(screen.getByText('Art')).toBeInTheDocument()
      expect(screen.getByText('Eigenschaften')).toBeInTheDocument()
    })

    it('filters by a selected tag and clears it again', async () => {
      const user = await renderRecipes()

      await user.click(screen.getByRole('button', { name: 'Vegan' }))
      expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByText('Rührei')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Vegan' }))
      expect(screen.getByText('Rührei')).toBeInTheDocument()
    })

    // Within a single-select group, picking a second tag replaces the first —
    // otherwise "Vegan AND Vegetarisch" would filter everything away.
    it('replaces the selection inside a single-select group', async () => {
      const user = await renderRecipes()

      await user.click(screen.getByRole('button', { name: 'Vegan' }))
      await user.click(screen.getByRole('button', { name: 'Vegetarisch' }))

      expect(screen.getByRole('button', { name: 'Vegan' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByRole('button', { name: 'Vegetarisch' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Rührei')).toBeInTheDocument()
    })

    it('combines tags across groups as AND', async () => {
      const user = await renderRecipes()

      await user.click(screen.getByRole('button', { name: 'Vegan' }))
      await user.click(screen.getByRole('button', { name: 'Scharf' }))
      expect(screen.getByText('Chili sin Carne')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Vegetarisch' }))
      expect(screen.getByText('Keine Rezepte gefunden.')).toBeInTheDocument()
    })

    it('groups tags it does not recognise under "Sonstiges"', async () => {
      db.clear()
      seed('recipes', [{ id: 'r9', title: 'Exot', category: null, tags: ['Selbsterfunden'] }])
      await renderRecipes()

      expect(screen.getByText('Sonstiges')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Selbsterfunden' })).toBeInTheDocument()
    })
  })

  describe('the add menu', () => {
    it('opens and offers all three ways to add a recipe', async () => {
      const user = await renderRecipes()
      await user.click(screen.getByRole('button', { name: 'Rezept hinzufügen' }))

      expect(screen.getByRole('link', { name: 'Rezept erstellen' })).toHaveAttribute('href', '/recipes/new')
      expect(screen.getByRole('link', { name: 'KI-Vorschlag' })).toHaveAttribute('href', '/recipes/suggest')
      expect(screen.getByRole('link', { name: 'Screenshot importieren' })).toHaveAttribute('href', '/recipes/import')
    })

    it('closes when clicking outside', async () => {
      const user = await renderRecipes()
      await user.click(screen.getByRole('button', { name: 'Rezept hinzufügen' }))
      await user.click(document.body)
      expect(screen.queryByRole('link', { name: 'KI-Vorschlag' })).not.toBeInTheDocument()
    })

    it('links to the weekly plan', async () => {
      await renderRecipes()
      expect(screen.getByRole('link', { name: 'Wochenplan' })).toHaveAttribute('href', '/plan')
    })
  })

  describe('adding missing ingredients to the shopping list', () => {
    it('adds only what is not in stock', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
      seed('recipe_ingredients', [
        { recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' },
        { recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' },
      ])
      seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
      const user = await renderRecipes()

      await openRowMenu(user, 'Chili')
      await user.click(screen.getByRole('button', { name: 'Fehlende zur Einkaufsliste' }))

      expect(await screen.findByRole('status')).toHaveTextContent('1 Zutaten zur Einkaufsliste hinzugefügt')
      await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(1))
      expect(rows('shopping_list_items')[0].name).toBe('Bohnen')
    })

    it('says so when everything is already in stock', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
      const user = await renderRecipes()

      await openRowMenu(user, 'Chili')
      await user.click(screen.getByRole('button', { name: 'Fehlende zur Einkaufsliste' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Alle Zutaten bereits vorhanden')
      expect(rows('shopping_list_items')).toHaveLength(0)
    })
  })

  describe('deleting a recipe', () => {
    beforeEach(() => {
      seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit', tags: ['Vegan'], portions: 4 }])
      seed('recipe_ingredients', [{ id: 'i1', recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' }])
    })

    it('removes it from the list and the database', async () => {
      const user = await renderRecipes()
      await openRowMenu(user, 'Chili')
      await user.click(screen.getByRole('button', { name: 'Löschen' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(0))
      expect(screen.queryByText('Chili')).not.toBeInTheDocument()
    })

    // A cascade delete takes the ingredient rows with it, so undo has to
    // restore both the recipe and its ingredients under a new id.
    it('restores the recipe and its ingredients on undo', async () => {
      const user = await renderRecipes()
      await openRowMenu(user, 'Chili')
      await user.click(screen.getByRole('button', { name: 'Löschen' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Chili gelöscht')
      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipes')[0]).toMatchObject({ title: 'Chili', portions: 4 })
      expect(rows('recipe_ingredients')).toHaveLength(1)
      expect(rows('recipe_ingredients')[0]).toMatchObject({ name: 'Bohnen', recipe_id: rows('recipes')[0].id })
    })

    it('restores a recipe that had no ingredients', async () => {
      db.set('recipe_ingredients', [])
      const user = await renderRecipes()
      await openRowMenu(user, 'Chili')
      await user.click(screen.getByRole('button', { name: 'Löschen' }))
      await user.click(await screen.findByRole('button', { name: 'Rückgängig' }))

      await waitFor(() => expect(rows('recipes')).toHaveLength(1))
      expect(rows('recipe_ingredients')).toHaveLength(0)
    })
  })

  it('closes a row menu when clicking outside', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    const user = await renderRecipes()

    await openRowMenu(user, 'Chili')
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument()

    await user.click(document.body)
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument()
  })

  it('updates availability when stock changes on another device', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
    seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
    await renderRecipes()
    expect(screen.getByRole('img', { name: '0 von 1 Zutaten vorhanden' })).toBeInTheDocument()

    seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByRole('img', { name: '1 von 1 Zutaten vorhanden' })).toBeInTheDocument())
  })
})
