import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AvailabilityMeter, { availabilityTone } from './AvailabilityMeter'

describe('availabilityTone', () => {
  it('is full when everything is in stock', () => {
    expect(availabilityTone(3, 3)).toBe('full')
  })

  // A recipe with no ingredients is trivially cookable, not "missing
  // everything" — it must not read as a warning.
  it('is full for a recipe with no ingredients', () => {
    expect(availabilityTone(0, 0)).toBe('full')
  })

  it('is partial when some but not all are in stock', () => {
    expect(availabilityTone(1, 3)).toBe('partial')
    expect(availabilityTone(2, 3)).toBe('partial')
  })

  it('is none when nothing is in stock', () => {
    expect(availabilityTone(0, 3)).toBe('none')
  })
})

describe('AvailabilityMeter', () => {
  it('renders nothing when there are no ingredients to show', () => {
    const { container } = render(<AvailabilityMeter available={0} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the ratio as text', () => {
    render(<AvailabilityMeter available={2} total={5} />)
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  // The count of filled segments, not their colour, carries the reading, and
  // the label restates it for anyone not seeing the segments at all.
  it('draws one segment per ingredient and fills the available ones', () => {
    render(<AvailabilityMeter available={2} total={5} />)
    const meter = screen.getByRole('img', { name: '2 von 5 Zutaten vorhanden' })
    const segments = [...meter.children]
    expect(segments).toHaveLength(5)
    expect(segments.filter((segment) => segment.className.includes('bg-rule'))).toHaveLength(3)
  })

  it('fills every segment when the recipe is fully covered', () => {
    render(<AvailabilityMeter available={3} total={3} />)
    const meter = screen.getByRole('img', { name: '3 von 3 Zutaten vorhanden' })
    expect([...meter.children].filter((segment) => segment.className.includes('bg-full'))).toHaveLength(3)
  })

  it('uses a distinct tone class for each state', () => {
    const { rerender } = render(<AvailabilityMeter available={0} total={3} />)
    expect(screen.getByText('0/3').className).toContain('text-none')

    rerender(<AvailabilityMeter available={1} total={3} />)
    expect(screen.getByText('1/3').className).toContain('text-partial')

    rerender(<AvailabilityMeter available={3} total={3} />)
    expect(screen.getByText('3/3').className).toContain('text-full')
  })

  it('passes an extra class through to the wrapper', () => {
    const { container } = render(<AvailabilityMeter available={1} total={2} className="mt-4" />)
    expect(container.firstElementChild?.className).toContain('mt-4')
  })
})
