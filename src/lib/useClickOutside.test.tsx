import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { useClickOutside } from './useClickOutside'

function Panel({ active, onOutsideClick }: { active: boolean; onOutsideClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, active, onOutsideClick)
  return (
    <div>
      <div ref={ref} data-testid="panel">
        <button type="button">drinnen</button>
      </div>
      <button type="button">draußen</button>
    </div>
  )
}

describe('useClickOutside', () => {
  it('fires when a click lands outside the ref', async () => {
    const onOutsideClick = vi.fn()
    const user = userEvent.setup()
    render(<Panel active onOutsideClick={onOutsideClick} />)
    await user.click(screen.getByRole('button', { name: 'draußen' }))
    expect(onOutsideClick).toHaveBeenCalledOnce()
  })

  it('does not fire for a click inside the ref', async () => {
    const onOutsideClick = vi.fn()
    const user = userEvent.setup()
    render(<Panel active onOutsideClick={onOutsideClick} />)
    await user.click(screen.getByRole('button', { name: 'drinnen' }))
    expect(onOutsideClick).not.toHaveBeenCalled()
  })

  it('does nothing while inactive', async () => {
    const onOutsideClick = vi.fn()
    const user = userEvent.setup()
    render(<Panel active={false} onOutsideClick={onOutsideClick} />)
    await user.click(screen.getByRole('button', { name: 'draußen' }))
    expect(onOutsideClick).not.toHaveBeenCalled()
  })

  it('detaches the listener on unmount', async () => {
    const onOutsideClick = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<Panel active onOutsideClick={onOutsideClick} />)
    unmount()
    await user.click(document.body)
    expect(onOutsideClick).not.toHaveBeenCalled()
  })
})
