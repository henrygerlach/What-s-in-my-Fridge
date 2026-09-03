import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import WasteStats from './WasteStats'
import { renderPage } from '../test/renderPage'
import { seed, emitRealtimeChange, db } from '../test/fakeSupabase'

vi.mock('../lib/supabase')

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function consumption(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Milch',
    category: 'Milchprodukte & Eier',
    quantity: 1,
    unit: 'l',
    reason: 'consumed',
    source: 'manual',
    recipe_title: null,
    item_added_at: null,
    logged_at: daysAgo(1),
    ...overrides,
  }
}

// "Aufgebraucht" and "Weggeworfen" appear both as stat-card labels and in the
// chart legend; the stat card is the one whose label follows a .stat value.
function statValue(label: string): string {
  const card = screen
    .getAllByText(label)
    .find((element) => element.previousElementSibling?.classList.contains('stat'))
  return card?.previousElementSibling?.textContent ?? ''
}

async function renderStats() {
  const view = renderPage(<WasteStats />)
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return view
}

describe('WasteStats', () => {
  it('shows a loading state before the first read resolves', () => {
    renderPage(<WasteStats />)
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('explains how data appears when there is none yet', async () => {
    await renderStats()
    expect(screen.getByText(/Noch keine Daten/)).toBeInTheDocument()
  })

  it('counts consumed and discarded items and the waste rate', async () => {
    seed('consumption_log', [
      consumption({ reason: 'consumed' }),
      consumption({ reason: 'consumed' }),
      consumption({ reason: 'consumed' }),
      consumption({ reason: 'discarded' }),
    ])
    await renderStats()

    expect(statValue('Aufgebraucht')).toBe('3')
    expect(statValue('Weggeworfen')).toBe('1')
    expect(statValue('Verschwendung')).toBe('25%')
  })

  it('reports a zero waste rate when nothing was discarded', async () => {
    seed('consumption_log', [consumption()])
    await renderStats()
    expect(statValue('Verschwendung')).toBe('0%')
  })

  it('draws the consumption trend', async () => {
    seed('consumption_log', [consumption()])
    await renderStats()
    expect(screen.getByRole('img', { name: 'Verlauf aufgebraucht vs. weggeworfen' })).toBeInTheDocument()
  })

  it('ranks the most-used foods', async () => {
    seed('consumption_log', [
      consumption({ name: 'Milch' }),
      consumption({ name: 'Milch' }),
      consumption({ name: 'Brot' }),
    ])
    await renderStats()

    const card = screen.getByText('Meistgenutzte Lebensmittel').parentElement as HTMLElement
    const labels = within(card).getAllByText(/Milch|Brot/)
    expect(labels[0]).toHaveTextContent('Milch')
  })

  it('ranks the most-cooked recipes', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_cook_log', [
      { recipe_id: 'r1', cooked_at: daysAgo(1) },
      { recipe_id: 'r1', cooked_at: daysAgo(2) },
    ])
    await renderStats()

    const card = screen.getByText('Lieblingsgerichte').parentElement as HTMLElement
    expect(within(card).getByText('Chili')).toBeInTheDocument()
    expect(within(card).getByText('2×')).toBeInTheDocument()
  })

  it('shows the average days in storage only when it can be computed', async () => {
    seed('consumption_log', [consumption({ item_added_at: daysAgo(5), logged_at: daysAgo(1) })])
    await renderStats()
    expect(statValue('Ø Tage bis zur Verwendung')).toBe('4.0')
  })

  it('omits the average when no entry records when the item was added', async () => {
    seed('consumption_log', [consumption({ item_added_at: null })])
    await renderStats()
    expect(screen.queryByText('Ø Tage bis zur Verwendung')).not.toBeInTheDocument()
  })

  it('names the most-wasted category', async () => {
    seed('consumption_log', [
      consumption({ reason: 'discarded', category: 'Obst & Gemüse' }),
      consumption({ reason: 'discarded', category: 'Obst & Gemüse' }),
      consumption({ reason: 'discarded', category: 'Getränke' }),
    ])
    await renderStats()
    expect(screen.getByText('meistverschwendete Kategorie').previousElementSibling).toHaveTextContent('Obst & Gemüse')
  })

  it('lists recently discarded items with amount and age', async () => {
    seed('consumption_log', [
      consumption({ name: 'Joghurt', quantity: 2, unit: 'Becher', reason: 'discarded', logged_at: daysAgo(3) }),
    ])
    await renderStats()

    const card = screen.getByText('Zuletzt weggeworfen').parentElement as HTMLElement
    expect(within(card).getByText('Joghurt (2 Becher)')).toBeInTheDocument()
    expect(within(card).getByText('vor 3 Tagen')).toBeInTheDocument()
  })

  it('omits the amount for a discarded item with no quantity', async () => {
    seed('consumption_log', [consumption({ name: 'Joghurt', quantity: null, reason: 'discarded' })])
    await renderStats()
    const card = screen.getByText('Zuletzt weggeworfen').parentElement as HTMLElement
    expect(within(card).getByText('Joghurt')).toBeInTheDocument()
  })

  it('omits the unit when a discarded item has a bare quantity', async () => {
    seed('consumption_log', [consumption({ name: 'Eier', quantity: 3, unit: null, reason: 'discarded' })])
    await renderStats()
    expect(screen.getByText('Eier (3)')).toBeInTheDocument()
  })

  it('hides the discard list when nothing was thrown away', async () => {
    seed('consumption_log', [consumption({ reason: 'consumed' })])
    await renderStats()
    expect(screen.queryByText('Zuletzt weggeworfen')).not.toBeInTheDocument()
  })

  it('shows cooking stats even when nothing was consumed', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili' }])
    seed('recipe_cook_log', [{ recipe_id: 'r1', cooked_at: daysAgo(1) }])
    await renderStats()

    expect(screen.getByText('Lieblingsgerichte')).toBeInTheDocument()
    expect(screen.queryByText('Verschwendung')).not.toBeInTheDocument()
  })

  it('excludes entries older than the thirty-day window', async () => {
    seed('consumption_log', [consumption({ logged_at: daysAgo(40) })])
    await renderStats()
    expect(screen.getByText(/Noch keine Daten/)).toBeInTheDocument()
  })

  // Another household member throwing something away must update this page
  // without a reload.
  it('reloads when a remote change arrives', async () => {
    await renderStats()
    expect(screen.getByText(/Noch keine Daten/)).toBeInTheDocument()

    db.set('consumption_log', [
      { id: 'new', ...consumption({ reason: 'discarded', name: 'Salat' }) },
    ])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByText('Salat')).toBeInTheDocument())
  })
})
