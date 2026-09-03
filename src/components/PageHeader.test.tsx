import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PageHeader from './PageHeader'
import BackLink from './BackLink'

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('BackLink', () => {
  it('is a labelled link to the given route', () => {
    renderWithRouter(<BackLink to="/recipes" />)
    const link = screen.getByRole('link', { name: 'Zurück' })
    expect(link).toHaveAttribute('href', '/recipes')
  })
})

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    renderWithRouter(<PageHeader title="Inventar" />)
    expect(screen.getByRole('heading', { name: 'Inventar' })).toBeInTheDocument()
  })

  it('omits the back link on a top-level page', () => {
    renderWithRouter(<PageHeader title="Inventar" />)
    expect(screen.queryByRole('link', { name: 'Zurück' })).not.toBeInTheDocument()
  })

  it('renders a back link when a target is given', () => {
    renderWithRouter(<PageHeader title="Rezept" back="/recipes" />)
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/recipes')
  })

  it('renders action children', () => {
    renderWithRouter(
      <PageHeader title="Inventar">
        <button type="button">Hinzufügen</button>
      </PageHeader>,
    )
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument()
  })
})
