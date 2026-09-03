import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MealPlan from './MealPlan'
import { renderPage } from '../test/renderPage'
import { seed, rows, functionsInvoke, emitRealtimeChange } from '../test/fakeSupabase'
import { formatDateKey, formatDayLabel, upcomingDays } from '../lib/mealPlan'

vi.mock('../lib/supabase')

const NOW = new Date(2026, 5, 15, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  functionsInvoke.mockResolvedValue({ data: { categories: [] }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

const days = () => upcomingDays(7, NOW)
const todayKey = () => formatDateKey(days()[0])
const todayLabel = () => formatDayLabel(days()[0])

async function renderPlan() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderPage(<MealPlan />, { path: '/plan', route: '/plan' })
  await waitFor(() => expect(screen.queryByText('Lädt...')).not.toBeInTheDocument())
  return user
}

function dayCard(label: string): HTMLElement {
  return screen.getByText(label).closest('li') as HTMLElement
}

async function openPicker(user: ReturnType<typeof userEvent.setup>, label = todayLabel()) {
  await user.click(within(dayCard(label)).getByRole('button', { name: '+ Rezept' }))
}

describe('MealPlan', () => {
  it('shows a loading state first', () => {
    renderPage(<MealPlan />)
    expect(screen.getByText('Lädt...')).toBeInTheDocument()
  })

  it('shows the next seven days, starting today', async () => {
    await renderPlan()
    for (const day of days()) {
      expect(screen.getByText(formatDayLabel(day))).toBeInTheDocument()
    }
  })

  it('marks empty days as unplanned', async () => {
    await renderPlan()
    expect(screen.getAllByText('Nichts geplant')).toHaveLength(7)
  })

  it('lists a planned recipe with its portions and a link', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
    seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 6 }])
    await renderPlan()

    const card = dayCard(todayLabel())
    expect(within(card).getByRole('link', { name: /Chili/ })).toHaveAttribute('href', '/recipes/r1')
    expect(within(card).getByText('6 Portionen')).toBeInTheDocument()
  })

  // The plan row outlives the recipe, so a deleted recipe must degrade
  // gracefully rather than render a broken link.
  it('marks an entry whose recipe was deleted', async () => {
    seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'gone', portions: 2 }])
    await renderPlan()
    expect(screen.getByText('Rezept gelöscht')).toBeInTheDocument()
  })

  it('omits the portion count when none was chosen', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
    seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: null }])
    await renderPlan()
    expect(screen.queryByText(/Portionen/)).not.toBeInTheDocument()
  })

  describe('adding a recipe to a day', () => {
    beforeEach(() => {
      seed('recipes', [
        { id: 'r1', title: 'Chili', portions: 4 },
        { id: 'r2', title: 'Rührei', portions: 2 },
      ])
    })

    it('offers every recipe, searchable', async () => {
      const user = await renderPlan()
      await openPicker(user)

      expect(screen.getByRole('button', { name: 'Chili' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('Rezept suchen'), 'rühr')
      expect(screen.queryByRole('button', { name: 'Chili' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rührei' })).toBeInTheDocument()
    })

    it('says when the search matches nothing', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.type(screen.getByLabelText('Rezept suchen'), 'Pizza')
      expect(screen.getByText('Keine Rezepte gefunden.')).toBeInTheDocument()
    })

    it('defaults the portion count to the recipe’s own', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.click(screen.getByRole('button', { name: 'Chili' }))
      expect(screen.getByText('4')).toBeInTheDocument()
    })

    it('falls back to one portion for a recipe that defines none', async () => {
      seed('recipes', [{ id: 'r3', title: 'Ohne Angabe', portions: null }])
      const user = await renderPlan()
      await openPicker(user)
      await user.click(screen.getByRole('button', { name: 'Ohne Angabe' }))
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('adjusts the portion count, never below one', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.click(screen.getByRole('button', { name: 'Rührei' }))

      await user.click(screen.getByRole('button', { name: 'Mehr Portionen' }))
      expect(screen.getByText('3')).toBeInTheDocument()

      for (let i = 0; i < 5; i += 1) {
        await user.click(screen.getByRole('button', { name: 'Weniger Portionen' }))
      }
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('saves the entry for the chosen day', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.click(screen.getByRole('button', { name: 'Chili' }))
      await user.click(screen.getByRole('button', { name: 'Hinzufügen' }))

      await waitFor(() => expect(rows('meal_plan_items')).toHaveLength(1))
      expect(rows('meal_plan_items')[0]).toMatchObject({ plan_date: todayKey(), recipe_id: 'r1', portions: 4 })
    })

    it('goes back from the portion step to the recipe list', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.click(screen.getByRole('button', { name: 'Chili' }))
      await user.click(screen.getByRole('button', { name: 'Zurück' }))

      expect(screen.getByLabelText('Rezept suchen')).toBeInTheDocument()
      expect(rows('meal_plan_items')).toHaveLength(0)
    })

    it('closes the picker when clicking outside', async () => {
      const user = await renderPlan()
      await openPicker(user)
      await user.click(document.body)
      expect(screen.queryByLabelText('Rezept suchen')).not.toBeInTheDocument()
    })

    it('opens a separate picker per day', async () => {
      const user = await renderPlan()
      await openPicker(user, todayLabel())
      expect(within(dayCard(todayLabel())).getByLabelText('Rezept suchen')).toBeInTheDocument()

      const tomorrow = formatDayLabel(days()[1])
      await openPicker(user, tomorrow)
      expect(within(dayCard(tomorrow)).getByLabelText('Rezept suchen')).toBeInTheDocument()
      expect(within(dayCard(todayLabel())).queryByLabelText('Rezept suchen')).not.toBeInTheDocument()
    })
  })

  describe('removing an entry', () => {
    beforeEach(() => {
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
      seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 }])
    })

    it('removes it from the plan', async () => {
      const user = await renderPlan()
      await user.click(screen.getByRole('button', { name: 'Aus dem Plan entfernen' }))

      await waitFor(() => expect(rows('meal_plan_items')).toHaveLength(0))
      expect(screen.getAllByText('Nichts geplant')).toHaveLength(7)
    })

    it('puts it back on undo, with the same day and portions', async () => {
      const user = await renderPlan()
      await user.click(screen.getByRole('button', { name: 'Aus dem Plan entfernen' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Aus dem Plan entfernt')

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
      await waitFor(() => expect(rows('meal_plan_items')).toHaveLength(1))
      expect(rows('meal_plan_items')[0]).toMatchObject({ plan_date: todayKey(), recipe_id: 'r1', portions: 4 })
    })
  })

  describe('shopping for the whole week', () => {
    it('is disabled while nothing is planned', async () => {
      await renderPlan()
      expect(screen.getByRole('button', { name: 'Fehlendes zur Liste' })).toBeDisabled()
    })

    it('adds only what the week is missing', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
      seed('recipe_ingredients', [
        { recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' },
        { recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' },
      ])
      seed('food_items', [{ name: 'Tomaten', quantity: 1, unit: 'kg' }])
      seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 }])
      const user = await renderPlan()

      await user.click(screen.getByRole('button', { name: 'Fehlendes zur Liste' }))
      expect(await screen.findByRole('status')).toHaveTextContent('1 Zutaten zur Einkaufsliste hinzugefügt')
      expect(rows('shopping_list_items')[0].name).toBe('Bohnen')
    })

    // Two planned days of the same recipe must produce one combined line
    // with double the amount, not two separate entries.
    it('combines a recipe planned twice into one doubled entry', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' }])
      seed('meal_plan_items', [
        { id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 },
        { id: 'p2', plan_date: formatDateKey(days()[1]), recipe_id: 'r1', portions: 4 },
      ])
      const user = await renderPlan()

      await user.click(screen.getByRole('button', { name: 'Fehlendes zur Liste' }))
      await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(1))
      expect(rows('shopping_list_items')[0]).toMatchObject({ name: 'Bohnen', quantity: 2, unit: 'Dose' })
    })

    it('scales an entry planned for more portions than the recipe serves', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 2 }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' }])
      seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 6 }])
      const user = await renderPlan()

      await user.click(screen.getByRole('button', { name: 'Fehlendes zur Liste' }))
      await waitFor(() => expect(rows('shopping_list_items')).toHaveLength(1))
      expect(rows('shopping_list_items')[0].quantity).toBe(3)
    })

    it('says so when the week is already covered', async () => {
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Tomaten', quantity: 400, unit: 'g' }])
      seed('food_items', [{ name: 'Tomaten', quantity: 5, unit: 'kg' }])
      seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 }])
      const user = await renderPlan()

      await user.click(screen.getByRole('button', { name: 'Fehlendes zur Liste' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Alle Zutaten für die Woche bereits vorhanden')
      expect(rows('shopping_list_items')).toHaveLength(0)
    })

    it('shows progress while checking', async () => {
      let resolve: (value: any) => void = () => {}
      functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
      seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
      seed('recipe_ingredients', [{ recipe_id: 'r1', name: 'Bohnen', quantity: 1, unit: 'Dose' }])
      seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 }])
      const user = await renderPlan()

      await user.click(screen.getByRole('button', { name: 'Fehlendes zur Liste' }))
      expect(await screen.findByRole('button', { name: 'Prüft...' })).toBeDisabled()

      resolve({ data: { categories: ['Konserven & Grundnahrungsmittel'] }, error: null })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Fehlendes zur Liste' })).toBeInTheDocument())
    })
  })

  it('picks up a plan change from another device', async () => {
    seed('recipes', [{ id: 'r1', title: 'Chili', portions: 4 }])
    await renderPlan()
    expect(screen.getAllByText('Nichts geplant')).toHaveLength(7)

    seed('meal_plan_items', [{ id: 'p1', plan_date: todayKey(), recipe_id: 'r1', portions: 4 }])
    await act(async () => {
      emitRealtimeChange()
    })

    await waitFor(() => expect(screen.getByRole('link', { name: /Chili/ })).toBeInTheDocument())
  })
})
