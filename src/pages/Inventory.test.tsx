import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Inventory from './Inventory'
import { renderPage } from '../test/renderPage'
import { seed, rows, functionsInvoke, emitRealtimeChange } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

// Fixed at midday so the "what can I cook" widget always asks for the same
// meal category ("Große Mahlzeit") rather than depending on the clock.
const NOON = new Date(2026, 5, 15, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOON)
  functionsInvoke.mockResolvedValue({ data: { categories: [] }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderInventory() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderPage(<Inventory />)
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return user
}

function itemRow(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('Inventory', () => {
  it('shows a loading state first', () => {
    renderPage(<Inventory />)
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('offers a first-item call to action when empty', async () => {
    await renderInventory()
    expect(screen.getByText('Dein Inventar ist leer.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Erstes Lebensmittel eintragen' })).toHaveAttribute('href', '/add')
  })

  it('hides the clear-all action while the inventory is empty', async () => {
    await renderInventory()
    expect(screen.queryByRole('button', { name: 'Leeren' })).not.toBeInTheDocument()
  })

  it('links to the add page and the statistics', async () => {
    await renderInventory()
    expect(screen.getByRole('link', { name: 'Artikel hinzufügen' })).toHaveAttribute('href', '/add')
    expect(screen.getByRole('link', { name: 'Statistik' })).toHaveAttribute('href', '/waste')
  })

  it('lists items grouped by category, with quantity and location', async () => {
    seed('food_items', [
      { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 1, unit: 'l', location: 'fridge' },
      { id: 'f2', name: 'Reis', category: 'Konserven & Grundnahrungsmittel', quantity: 500, unit: 'g', location: 'pantry' },
    ])
    await renderInventory()

    expect(within(itemRow('Milch')).getByText('1 l · Kühlschrank')).toBeInTheDocument()
    expect(within(itemRow('Reis')).getByText('500 g · Vorrat')).toBeInTheDocument()
  })

  it('shows only the location for an item with no quantity', async () => {
    seed('food_items', [{ id: 'f1', name: 'Salz', category: 'Gewürze & Saucen', quantity: null, unit: null, location: 'pantry' }])
    await renderInventory()
    expect(within(itemRow('Salz')).getByText('Vorrat')).toBeInTheDocument()
  })

  describe('searching and filtering', () => {
    beforeEach(() => {
      seed('food_items', [
        { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 1, unit: 'l', location: 'fridge' },
        { id: 'f2', name: 'Reis', category: 'Konserven & Grundnahrungsmittel', quantity: 500, unit: 'g', location: 'pantry' },
        { id: 'f3', name: 'Erbsen', category: 'Tiefkühl', quantity: 1, unit: 'Packung', location: 'freezer' },
      ])
    })

    it('filters by storage location', async () => {
      const user = await renderInventory()

      await user.click(screen.getByRole('button', { name: 'Vorrat' }))
      expect(screen.getByText('Reis')).toBeInTheDocument()
      expect(screen.queryByText('Milch')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Gefrierfach' }))
      expect(screen.getByText('Erbsen')).toBeInTheDocument()
      expect(screen.queryByText('Reis')).not.toBeInTheDocument()
    })

    it('returns to everything with the "Alle" filter', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Vorrat' }))
      await user.click(screen.getByRole('button', { name: 'Alle' }))
      expect(screen.getByText('Milch')).toBeInTheDocument()
      expect(screen.getByText('Erbsen')).toBeInTheDocument()
    })

    it('searches by name, case-insensitively', async () => {
      const user = await renderInventory()
      await user.type(screen.getByLabelText('Lebensmittel suchen'), 'milc')
      expect(screen.getByText('Milch')).toBeInTheDocument()
      expect(screen.queryByText('Reis')).not.toBeInTheDocument()
    })

    it('says when nothing matches, without the first-item link', async () => {
      const user = await renderInventory()
      await user.type(screen.getByLabelText('Lebensmittel suchen'), 'Ananas')
      expect(screen.getByText('Keine Lebensmittel gefunden.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Erstes Lebensmittel eintragen' })).not.toBeInTheDocument()
    })

    it('combines search and location filter', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Kühlschrank' }))
      await user.type(screen.getByLabelText('Lebensmittel suchen'), 'Reis')
      expect(screen.getByText('Keine Lebensmittel gefunden.')).toBeInTheDocument()
    })
  })

  describe('the "what can I cook" widget', () => {
    it('lists cookable recipes for the current mealtime', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ id: 'f1', name: 'Tomaten', category: 'Obst & Gemüse', quantity: 1, unit: 'kg', location: 'pantry' }])
      await renderInventory()

      expect(screen.getByText('Was koche ich heute?')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Chili/ })).toHaveAttribute('href', '/recipes/r1')
    })

    // Suggesting a dinner at 08:00 is worse than suggesting nothing.
    it('ignores recipes for a different mealtime', async () => {
      seed('recipes', [{ id: 'r1', title: 'Müsli', category: 'Frühstück' }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Hafer', quantity: 50, unit: 'g' }])
      seed('food_items', [{ id: 'f1', name: 'Hafer', category: 'Sonstiges', quantity: 1, unit: 'kg', location: 'pantry' }])
      await renderInventory()
      expect(screen.queryByText('Was koche ich heute?')).not.toBeInTheDocument()
    })

    it('stays hidden when nothing is cookable', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', category: 'Große Mahlzeit' }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      await renderInventory()
      expect(screen.queryByText('Was koche ich heute?')).not.toBeInTheDocument()
    })

    it('shows at most three recipes', async () => {
      seed(
        'recipes',
        Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `Rezept ${i}`, category: 'Große Mahlzeit' })),
      )
      seed(
        'recipe_ingredients',
        Array.from({ length: 5 }, (_, i) => ({ recipe_id: `r${i}`, name: 'Tomaten', quantity: 100, unit: 'g' })),
      )
      seed('food_items', [{ id: 'f1', name: 'Tomaten', category: 'Obst & Gemüse', quantity: 1, unit: 'kg', location: 'pantry' }])
      await renderInventory()

      const widget = screen.getByText('Was koche ich heute?').closest('section') as HTMLElement
      expect(within(widget).getAllByRole('link')).toHaveLength(3)
    })
  })

  describe('consuming an item', () => {
    beforeEach(() => {
      seed('food_items', [
        { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 2, unit: 'l', location: 'fridge' },
      ])
    })

    it('offers quarter fractions', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))

      expect(screen.getByText('Wie viel ist weg?')).toBeInTheDocument()
      for (const label of ['1/4', '1/2', '3/4', 'Ganz']) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      }
    })

    it('reduces the quantity for a partial amount and logs it', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.click(screen.getByRole('button', { name: '1/2' }))

      await waitFor(() => expect(rows('food_items')[0].quantity).toBe(1))
      expect(rows('consumption_log')[0]).toMatchObject({ name: 'Milch', quantity: 1, reason: 'consumed' })
    })

    it('deletes the row when the whole amount is used', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.click(screen.getByRole('button', { name: 'Ganz' }))

      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
      expect(rows('consumption_log')[0]).toMatchObject({ reason: 'consumed' })
    })

    it('accepts a typed custom amount', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.type(screen.getByLabelText('Verbrauchte Menge'), '0.5')
      await user.click(screen.getByRole('button', { name: 'OK' }))

      await waitFor(() => expect(rows('food_items')[0].quantity).toBe(1.5))
    })

    it('ignores a zero or negative custom amount', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.type(screen.getByLabelText('Verbrauchte Menge'), '0')
      await user.click(screen.getByRole('button', { name: 'OK' }))

      expect(rows('food_items')[0].quantity).toBe(2)
    })

    it('restores the previous quantity on undo', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.click(screen.getByRole('button', { name: '1/2' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Milch: Menge aktualisiert')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')[0].quantity).toBe(2))
    })

    // With no quantity there is nothing to take a fraction of, so the item
    // goes straight out rather than opening a meaningless picker.
    it('removes a quantity-less item immediately', async () => {
      seed('food_items', [{ id: 'f2', name: 'Salz', category: 'Gewürze & Saucen', quantity: null, unit: null, location: 'pantry' }])
      const user = await renderInventory()

      await user.click(within(itemRow('Salz')).getByRole('button', { name: 'Verbraucht' }))
      await waitFor(() => expect(rows('food_items').find((item) => item.name === 'Salz')).toBeUndefined())
      expect(screen.queryByText('Wie viel ist weg?')).not.toBeInTheDocument()
    })

    it('closes the picker when clicking outside', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: 'Verbraucht' }))
      await user.click(document.body)
      expect(screen.queryByText('Wie viel ist weg?')).not.toBeInTheDocument()
    })
  })

  describe('discarding an item', () => {
    it('removes it and records it as waste', async () => {
      seed('food_items', [{ id: 'f1', name: 'Joghurt', category: 'Milchprodukte & Eier', quantity: 1, unit: 'Becher', location: 'fridge' }])
      const user = await renderInventory()

      await user.click(within(itemRow('Joghurt')).getByRole('button', { name: 'Weggeworfen' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
      expect(rows('consumption_log')[0]).toMatchObject({ name: 'Joghurt', reason: 'discarded' })
      expect(await screen.findByRole('status')).toHaveTextContent('Joghurt weggeworfen')
    })

    it('puts the item back on undo', async () => {
      seed('food_items', [{ id: 'f1', name: 'Joghurt', category: 'Milchprodukte & Eier', quantity: 1, unit: 'Becher', location: 'fridge' }])
      const user = await renderInventory()

      await user.click(within(itemRow('Joghurt')).getByRole('button', { name: 'Weggeworfen' }))
      await user.click(await screen.findByRole('button', { name: 'Rückgängig' }))

      await waitFor(() => expect(rows('food_items')).toHaveLength(1))
      expect(rows('food_items')[0]).toMatchObject({ name: 'Joghurt', quantity: 1, location: 'fridge' })
    })
  })

  describe('adding an item to the shopping list', () => {
    beforeEach(() => {
      seed('food_items', [
        { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 2, unit: 'l', location: 'fridge' },
      ])
    })

    it('carries over the unit and category', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: '+ Liste' }))
      await user.type(screen.getByLabelText('Menge für die Einkaufsliste'), '3')
      await user.click(screen.getByRole('button', { name: 'OK' }))

      await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(1))
      expect(rows('shopping_list_items')[0]).toMatchObject({
        name: 'Milch',
        quantity: 3,
        unit: 'l',
        category: 'Milchprodukte & Eier',
      })
      expect(await screen.findByRole('status')).toHaveTextContent('Milch zur Einkaufsliste hinzugefügt')
    })

    it('adds without a quantity when none is typed', async () => {
      const user = await renderInventory()
      await user.click(within(itemRow('Milch')).getByRole('button', { name: '+ Liste' }))
      await user.click(screen.getByRole('button', { name: 'OK' }))

      await waitFor(() => expect(rows('shopping_list_items')[0].quantity).toBeNull())
    })
  })

  describe('staples', () => {
    beforeEach(() => {
      seed('food_items', [
        { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 1, unit: 'l', location: 'fridge' },
      ])
    })

    it('marks and unmarks an item as a staple', async () => {
      const user = await renderInventory()

      await user.click(screen.getByRole('button', { name: 'Als Standardvorrat markieren' }))
      await waitFor(() => expect(rows('staple_items')).toHaveLength(1))
      expect(rows('staple_items')[0].name).toBe('Milch')

      await user.click(await screen.findByRole('button', { name: 'Standardvorrat entfernen' }))
      await waitFor(() => expect(rows('staple_items')).toHaveLength(0))
    })

    it('warns about a staple that has run out', async () => {
      seed('staple_items', [{ id: 's1', name: 'Mehl' }])
      await renderInventory()

      expect(screen.getByText('Standardvorrat leer')).toBeInTheDocument()
      expect(screen.getByText('Mehl')).toBeInTheDocument()
    })

    it('does not warn about a staple that is in stock', async () => {
      seed('staple_items', [{ id: 's1', name: 'Milch' }])
      await renderInventory()
      expect(screen.queryByText('Standardvorrat leer')).not.toBeInTheDocument()
    })

    it('does not warn about a staple already on the shopping list', async () => {
      seed('staple_items', [{ id: 's1', name: 'Mehl' }])
      seed('shopping_list_items', [{ name: 'Mehl', quantity: null, unit: null, category: null }])
      await renderInventory()
      expect(screen.queryByText('Standardvorrat leer')).not.toBeInTheDocument()
    })

    it('adds a missing staple to the shopping list', async () => {
      seed('staple_items', [{ id: 's1', name: 'Mehl' }])
      const user = await renderInventory()

      const warning = screen.getByText('Standardvorrat leer').closest('div') as HTMLElement
      await user.click(within(warning).getByRole('button', { name: '+ Liste' }))

      await waitFor(() => expect(rows('shopping_list_items')[0].name).toBe('Mehl'))
      expect(await screen.findByRole('status')).toHaveTextContent('Mehl zur Einkaufsliste hinzugefügt')
    })
  })

  describe('clearing the whole inventory', () => {
    beforeEach(() => {
      seed('food_items', [
        { id: 'f1', name: 'Milch', category: 'Milchprodukte & Eier', quantity: 1, unit: 'l', location: 'fridge' },
        { id: 'f2', name: 'Reis', category: 'Konserven & Grundnahrungsmittel', quantity: 500, unit: 'g', location: 'pantry' },
      ])
    })

    it('asks for confirmation, naming the count', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Leeren' }))
      expect(screen.getByText(/Artikel wirklich löschen\?/)).toBeInTheDocument()
    })

    it('can be cancelled', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Leeren' }))
      await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

      expect(screen.queryByText(/wirklich löschen/)).not.toBeInTheDocument()
      expect(rows('food_items')).toHaveLength(2)
    })

    it('deletes everything and can be undone', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Leeren' }))
      await user.click(screen.getByRole('button', { name: 'Löschen' }))

      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
      expect(await screen.findByRole('status')).toHaveTextContent('2 Artikel gelöscht')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(2))
    })

    it('closes the confirmation when clicking outside', async () => {
      const user = await renderInventory()
      await user.click(screen.getByRole('button', { name: 'Leeren' }))
      await user.click(document.body)
      expect(screen.queryByText(/wirklich löschen/)).not.toBeInTheDocument()
    })
  })

  it('picks up an item added on another device', async () => {
    await renderInventory()
    expect(screen.getByText('Dein Inventar ist leer.')).toBeInTheDocument()

    seed('food_items', [{ id: 'f9', name: 'Butter', category: 'Milchprodukte & Eier', quantity: 1, unit: 'Packung', location: 'fridge' }])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByText('Butter')).toBeInTheDocument())
  })
})
