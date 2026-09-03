import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConsumptionTrendChart from './ConsumptionTrendChart'
import type { PeriodTotals } from '../lib/foodStats'

const data: PeriodTotals[] = [
  { label: '1.6.', consumed: 3, discarded: 1 },
  { label: '6.6.', consumed: 0, discarded: 0 },
  { label: '11.6.', consumed: 5, discarded: 2 },
]

function chart(overrides: PeriodTotals[] = data) {
  return render(<ConsumptionTrendChart data={overrides} />)
}

// The gridline maximum is the first <text> node in the chart.
function axisMax(container: HTMLElement): string | null | undefined {
  return container.querySelector('svg > text')?.textContent
}

describe('ConsumptionTrendChart', () => {
  it('labels the chart and both series', () => {
    chart()
    expect(screen.getByRole('img', { name: 'Verlauf aufgebraucht vs. weggeworfen' })).toBeInTheDocument()
    expect(screen.getByText('Aufgebraucht')).toBeInTheDocument()
    expect(screen.getByText('Weggeworfen')).toBeInTheDocument()
  })

  it('draws one labelled bucket per period', () => {
    chart()
    for (const bucket of data) {
      expect(screen.getByText(bucket.label)).toBeInTheDocument()
    }
  })

  it('prompts for interaction before anything is selected', () => {
    chart()
    expect(screen.getByText('Zeitraum antippen für Details')).toBeInTheDocument()
  })

  it('shows the totals for a tapped period', () => {
    const { container } = chart()
    fireEvent.click(container.querySelectorAll('g')[0])
    expect(screen.getByText('Ab 1.6.: 3 aufgebraucht, 1 weggeworfen')).toBeInTheDocument()
  })

  it('deselects when the same period is tapped again', () => {
    const { container } = chart()
    const group = container.querySelectorAll('g')[0]
    fireEvent.click(group)
    fireEvent.click(group)
    expect(screen.getByText('Zeitraum antippen für Details')).toBeInTheDocument()
  })

  it('switches selection between periods', () => {
    const { container } = chart()
    const groups = container.querySelectorAll('g')
    fireEvent.click(groups[0])
    fireEvent.click(groups[2])
    expect(screen.getByText('Ab 11.6.: 5 aufgebraucht, 2 weggeworfen')).toBeInTheDocument()
  })

  it('dims the other bars while one period is selected', () => {
    const { container } = chart()
    fireEvent.click(container.querySelectorAll('g')[0])
    const dimmed = [...container.querySelectorAll('rect')].filter((rect) => rect.getAttribute('opacity') === '0.35')
    expect(dimmed.length).toBeGreaterThan(0)
  })

  it('omits a bar for a series with nothing in it', () => {
    const { container } = render(<ConsumptionTrendChart data={[{ label: '1.6.', consumed: 2, discarded: 0 }]} />)
    const coloured = [...container.querySelectorAll('rect')].filter(
      (rect) => rect.getAttribute('fill') !== 'transparent',
    )
    expect(coloured).toHaveLength(1)
  })

  it('shows a per-bucket total only where something happened', () => {
    chart()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  // The y-axis label is the rounded gridline max, not the raw peak. It is the
  // first <text> in the svg, so it is read positionally rather than by value —
  // the value can collide with a bar's own total label.
  it('rounds the axis maximum up to a clean gridline value', () => {
    for (const [peak, expected] of [
      [3, '5'],
      [34, '50'],
      [6, '10'],
      [10, '10'],
      [120, '200'],
      [0, '1'],
    ] as const) {
      const { container, unmount } = render(
        <ConsumptionTrendChart data={[{ label: 'a', consumed: peak, discarded: 0 }]} />,
      )
      expect(axisMax(container)).toBe(expected)
      unmount()
    }
  })

  it('scales the axis to the stacked total, not to either series alone', () => {
    const { container } = render(<ConsumptionTrendChart data={[{ label: 'a', consumed: 3, discarded: 4 }]} />)
    expect(axisMax(container)).toBe('10')
  })
})
