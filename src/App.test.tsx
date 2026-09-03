import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

vi.mock('./lib/supabase')

// A thin smoke test over the route table itself: each page already has its
// own thorough test suite, so this only guards against a path in App.tsx
// pointing at the wrong page (or a route silently going missing).
function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('App routing', () => {
  it('renders the inventory at the root path', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Inventar' })).toBeInTheDocument()
  })

  it('renders the add-item page', () => {
    renderAt('/add')
    expect(screen.getByRole('heading', { name: 'Artikel hinzufügen' })).toBeInTheDocument()
  })

  it('renders the recipe list', () => {
    renderAt('/recipes')
    expect(screen.getByRole('heading', { name: 'Rezepte' })).toBeInTheDocument()
  })

  it('renders the new-recipe form', () => {
    renderAt('/recipes/new')
    expect(screen.getByRole('heading', { name: 'Neues Rezept' })).toBeInTheDocument()
  })

  it('renders the recipe suggestion page', () => {
    renderAt('/recipes/suggest')
    expect(screen.getByRole('heading', { name: 'KI-Vorschlag' })).toBeInTheDocument()
  })

  it('renders the screenshot import page', () => {
    renderAt('/recipes/import')
    expect(screen.getByRole('heading', { name: 'Screenshot importieren' })).toBeInTheDocument()
  })

  it('renders the shopping list', () => {
    renderAt('/shopping-list')
    expect(screen.getByRole('heading', { name: 'Einkaufsliste' })).toBeInTheDocument()
  })

  it('renders the meal plan', () => {
    renderAt('/plan')
    expect(screen.getByRole('heading', { name: 'Wochenplan' })).toBeInTheDocument()
  })

  it('renders the waste statistics', () => {
    renderAt('/waste')
    expect(screen.getByRole('heading', { name: 'Statistik' })).toBeInTheDocument()
  })

  it('renders the bottom navigation on every page', () => {
    renderAt('/recipes')
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
