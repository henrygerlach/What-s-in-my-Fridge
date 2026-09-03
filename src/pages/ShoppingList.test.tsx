import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShoppingList from './ShoppingList'
import { renderPage } from '../test/renderPage'
import { seed, rows, functionsInvoke, failOn, emitRealtimeChange, db } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

beforeEach(() => {
  functionsInvoke.mockResolvedValue({ data: { category: 'Getränke', location: 'pantry' }, error: null })
})

async function renderList() {
  const user = userEvent.setup()
  renderPage(<ShoppingList />)
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return user
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('ShoppingList', () => {
  it('shows a loading state first', () => {
    renderPage(<ShoppingList />)
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('explains where entries come from when the list is empty', async () => {
    await renderList()
    expect(screen.getByText('Deine Einkaufsliste ist leer.')).toBeInTheDocument()
    expect(screen.getByText(/Fehlende Zutaten landen hier/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alle ins Inventar' })).not.toBeInTheDocument()
  })

  it('groups entries by category in the inventory’s own order', async () => {
    seed('shopping_list_items', [
      { name: 'Cola', category: 'Getränke', created_at: '2026-06-01T00:00:00.000Z' },
      { name: 'Apfel', category: 'Obst & Gemüse', created_at: '2026-06-02T00:00:00.000Z' },
      { name: 'Rätsel', category: null, created_at: '2026-06-03T00:00:00.000Z' },
    ])
    await renderList()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings.some((text) => text?.includes('Obst & Gemüse'))).toBe(true)
    expect(headings.at(-1)).toContain('Ohne Kategorie')
  })

  it('removes an entry', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
    const user = await renderList()

    await user.click(screen.getByRole('button', { name: 'Cola von der Liste entfernen' }))
    await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(0))
    expect(screen.queryByText('Cola')).not.toBeInTheDocument()
  })

  it('edits a quantity', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Cola', quantity: 1, unit: 'l', category: 'Getränke' }])
    const user = await renderList()

    const input = screen.getByLabelText('Menge für Cola')
    await user.clear(input)
    await user.type(input, '3')
    await waitFor(() => expect(rows('shopping_list_items')[0].quantity).toBe(3))
  })

  it('clears a quantity back to none', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Cola', quantity: 2, unit: 'l', category: 'Getränke' }])
    const user = await renderList()

    await user.clear(screen.getByLabelText('Menge für Cola'))
    await waitFor(() => expect(rows('shopping_list_items')[0].quantity).toBeNull())
  })

  it('changes and clears a unit', async () => {
    seed('shopping_list_items', [{ id: 'a', name: 'Cola', quantity: 1, unit: 'l', category: 'Getränke' }])
    const user = await renderList()

    await user.selectOptions(screen.getByLabelText('Einheit für Cola'), 'ml')
    await waitFor(() => expect(rows('shopping_list_items')[0].unit).toBe('ml'))

    await user.selectOptions(screen.getByLabelText('Einheit für Cola'), '')
    await waitFor(() => expect(rows('shopping_list_items')[0].unit).toBeNull())
  })

  describe('buying a single item', () => {
    it('asks where to put it and pre-selects the fridge', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      expect(screen.getByText(/Wohin damit\?/)).toBeInTheDocument()
      expect(within(row('Cola')).getByRole('button', { name: /Kühlschrank/ })).toHaveAttribute('aria-pressed', 'true')
    })

    // An entry added from a recipe has no category, so the location is worth
    // a model call; one that already has a category is not.
    it('classifies an uncategorized entry to pick a location', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: null }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await waitFor(() => expect(functionsInvoke).toHaveBeenCalledWith('classify-item', { body: { name: 'Cola' } }))
      await waitFor(() =>
        expect(within(row('Cola')).getByRole('button', { name: /Vorrat/ })).toHaveAttribute('aria-pressed', 'true'),
      )
    })

    it('does not classify an entry that already has a category', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      expect(functionsInvoke).not.toHaveBeenCalled()
    })

    it('locks the panel while the suggestion is in flight', async () => {
      let resolve: (value: any) => void = () => {}
      functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: null }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      expect(await screen.findByText('wird vorgeschlagen...')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' })).toBeDisabled()

      resolve({ data: { category: 'Getränke', location: 'pantry' }, error: null })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' })).toBeEnabled())
    })

    it('keeps the fridge when classification fails', async () => {
      functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: null }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await waitFor(() =>
        expect(within(row('Cola')).getByRole('button', { name: /Kühlschrank/ })).toHaveAttribute('aria-pressed', 'true'),
      )
    })

    it('lets the user override the suggested location', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Erbsen', quantity: 1, unit: 'Packung', category: 'Tiefkühl' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await user.click(within(row('Erbsen')).getByRole('button', { name: /Gefrierfach/ }))
      await user.click(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' }))

      await waitFor(() => expect(rows('food_items')).toHaveLength(1))
      expect(rows('food_items')[0]).toMatchObject({ name: 'Erbsen', location: 'freezer', category: 'Tiefkühl' })
    })

    it('closes the panel on cancel without writing anything', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

      expect(screen.queryByText(/Wohin damit\?/)).not.toBeInTheDocument()
      expect(rows('food_items')).toHaveLength(0)
      expect(rows('shopping_list_items')).toHaveLength(1)
    })

    it('moves the item into the inventory and off the list', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', quantity: 2, unit: 'l', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await user.click(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' }))

      await waitFor(() => expect(rows('food_items')).toHaveLength(1))
      expect(rows('food_items')[0]).toMatchObject({ name: 'Cola', quantity: 2, unit: 'l', category: 'Getränke' })
      expect(rows('shopping_list_items')).toHaveLength(0)
      expect(rows('inventory_log')[0]).toMatchObject({ source: 'shopping' })
    })

    it('reports a failed move and leaves the entry on the list', async () => {
      failOn('food_items', 'insert')
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await user.click(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Fehler beim Hinzufügen')
      expect(rows('shopping_list_items')).toHaveLength(1)
    })

    // Undo has to reverse both halves of the move, not just one.
    it('undoes the move, restoring the list entry and removing the stock', async () => {
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', quantity: 2, unit: 'l', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Gekauft' }))
      await user.click(screen.getByRole('button', { name: 'Ins Inventar aufnehmen' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Cola ins Inventar verschoben')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
      expect(rows('shopping_list_items')).toHaveLength(1)
      expect(rows('shopping_list_items')[0]).toMatchObject({ name: 'Cola', quantity: 2, unit: 'l', category: 'Getränke' })
    })
  })

  describe('buying everything at once', () => {
    it('moves every entry and reports how many succeeded', async () => {
      seed('shopping_list_items', [
        { id: 'a', name: 'Cola', quantity: 1, unit: 'l', category: 'Getränke' },
        { id: 'b', name: 'Apfel', quantity: 3, unit: 'Stück', category: 'Obst & Gemüse' },
      ])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(2))
      expect(rows('shopping_list_items')).toHaveLength(0)
      expect(await screen.findByRole('status')).toHaveTextContent('2 von 2 Artikeln ins Inventar verschoben')
    })

    it('classifies only the entries that lack a category', async () => {
      seed('shopping_list_items', [
        { id: 'a', name: 'Cola', category: 'Getränke' },
        { id: 'b', name: 'Rätsel', category: null },
      ])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(2))
      expect(functionsInvoke).toHaveBeenCalledTimes(1)
      expect(functionsInvoke).toHaveBeenCalledWith('classify-item', { body: { name: 'Rätsel' } })
    })

    it('reports partial success and keeps the failed entries', async () => {
      failOn('food_items', 'insert')
      seed('shopping_list_items', [{ id: 'a', name: 'Cola', category: 'Getränke' }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('0 von 1 Artikeln ins Inventar verschoben')
      expect(rows('shopping_list_items')).toHaveLength(1)
    })

    it('shows progress while the batch runs', async () => {
      let resolve: (value: any) => void = () => {}
      functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
      seed('shopping_list_items', [{ id: 'a', name: 'Rätsel', category: null }])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      expect(await screen.findByRole('button', { name: 'Speichert...' })).toBeDisabled()

      resolve({ data: { category: 'Sonstiges', location: 'pantry' }, error: null })
      await waitFor(() => expect(screen.queryByText('Speichert...')).not.toBeInTheDocument())
    })

    it('undoes the whole batch', async () => {
      seed('shopping_list_items', [
        { id: 'a', name: 'Cola', quantity: 1, unit: 'l', category: 'Getränke' },
        { id: 'b', name: 'Apfel', quantity: 3, unit: 'Stück', category: 'Obst & Gemüse' },
      ])
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('2 von 2')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(0))
      expect(rows('shopping_list_items')).toHaveLength(2)
    })

    it('handles more entries than the concurrency limit', async () => {
      seed(
        'shopping_list_items',
        Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, name: `Ware ${i}`, category: 'Sonstiges' })),
      )
      const user = await renderList()

      await user.click(screen.getByRole('button', { name: 'Alle ins Inventar' }))
      await waitFor(() => expect(rows('food_items')).toHaveLength(12), { timeout: 3000 })
      expect(await screen.findByRole('status')).toHaveTextContent('12 von 12')
    })
  })

  it('picks up another device’s change without a reload', async () => {
    await renderList()
    expect(screen.getByText('Deine Einkaufsliste ist leer.')).toBeInTheDocument()

    db.set('shopping_list_items', [{ id: 'new', name: 'Brot', category: 'Brot & Backwaren', quantity: null, unit: null }])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByText('Brot')).toBeInTheDocument())
    expect(screen.queryByText('Lädt...')).not.toBeInTheDocument()
  })
})
