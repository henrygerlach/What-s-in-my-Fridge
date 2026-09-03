import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'

interface TriggerProps {
  message: string
  action?: { label: string; onAction: () => void }
  durationMs?: number
}

function Trigger({ message, action, durationMs }: TriggerProps) {
  const showToast = useToast()
  return (
    <button type="button" onClick={() => showToast(message, action, durationMs)}>
      {message}
    </button>
  )
}

function renderWithProvider(ui: ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('renders children and shows nothing initially', () => {
    renderWithProvider(<Trigger message="Gespeichert" />)
    expect(screen.getByRole('button', { name: 'Gespeichert' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a message when asked', () => {
    renderWithProvider(<Trigger message="Gespeichert" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gespeichert' }))
    expect(screen.getByRole('status')).toHaveTextContent('Gespeichert')
  })

  it('hides the message after the default five seconds', () => {
    vi.useFakeTimers()
    renderWithProvider(<Trigger message="Gespeichert" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gespeichert' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    advance(4999)
    expect(screen.getByRole('status')).toBeInTheDocument()

    advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('honours a custom duration', () => {
    vi.useFakeTimers()
    renderWithProvider(<Trigger message="Kurz" durationMs={1000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kurz' }))

    advance(999)
    expect(screen.getByRole('status')).toBeInTheDocument()

    advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders an action button, runs it, and dismisses immediately', () => {
    const onAction = vi.fn()
    renderWithProvider(<Trigger message="Gelöscht" action={{ label: 'Rückgängig', onAction }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gelöscht' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // The first toast's pending timer must not cut the second one short.
  it('replaces an existing toast and restarts the timer', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger message="Erste" />
        <Trigger message="Zweite" />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Erste' }))
    advance(4000)
    fireEvent.click(screen.getByRole('button', { name: 'Zweite' }))
    expect(screen.getByRole('status')).toHaveTextContent('Zweite')

    advance(4999)
    expect(screen.getByRole('status')).toHaveTextContent('Zweite')

    advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // The dismiss timer is keyed by toast id, so an expiring older timer must
  // leave a newer toast alone rather than blanking it.
  it('leaves a newer toast alone when an older timer expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'))
    render(
      <ToastProvider>
        <Trigger message="Erste" durationMs={1000} />
        <Trigger message="Zweite" durationMs={10_000} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Erste' }))
    vi.setSystemTime(new Date('2026-06-15T00:00:01.000Z'))
    fireEvent.click(screen.getByRole('button', { name: 'Zweite' }))

    advance(2000)
    expect(screen.getByRole('status')).toHaveTextContent('Zweite')
  })

  it('cancels the pending timer when the action is used', () => {
    vi.useFakeTimers()
    const onAction = vi.fn()
    renderWithProvider(<Trigger message="Gelöscht" action={{ label: 'Rückgängig', onAction }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gelöscht' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))

    advance(10_000)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('useToast', () => {
  it('throws a named error when used outside a provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger message="x" />)).toThrow('useToast must be used within a ToastProvider')
    consoleError.mockRestore()
  })
})
