import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it('links to the three top-level sections', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Inventar' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Rezepte' })).toHaveAttribute('href', '/recipes')
    expect(screen.getByRole('link', { name: 'Einkauf' })).toHaveAttribute('href', '/shopping-list')
  })

  it('marks the current section as active', () => {
    renderAt('/recipes')
    expect(screen.getByRole('link', { name: 'Rezepte' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inventar' })).not.toHaveAttribute('aria-current')
  })

  // Inventory is matched with `end`, so a deeper route must not light it up
  // alongside the section the user is actually in.
  it('does not keep the inventory tab active on a nested route', () => {
    renderAt('/recipes/abc')
    expect(screen.getByRole('link', { name: 'Inventar' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Rezepte' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the shopping tab active on its own nested routes', () => {
    renderAt('/shopping-list/anything')
    expect(screen.getByRole('link', { name: 'Einkauf' })).toHaveAttribute('aria-current', 'page')
  })

  it('hides the decorative icons from assistive technology', () => {
    const { container } = renderAt('/')
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden')
    }
  })
})
