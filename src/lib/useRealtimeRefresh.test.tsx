import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRealtimeRefresh } from './useRealtimeRefresh'
import { channelOn, channelSubscribe, removeChannel, emitRealtimeChange } from '../test/fakeSupabase'

vi.mock('./supabase')

describe('useRealtimeRefresh', () => {
  it('subscribes once and registers one listener per table', () => {
    renderHook(() => useRealtimeRefresh([{ table: 'food_items' }, { table: 'recipes' }], () => {}))
    expect(channelSubscribe).toHaveBeenCalledTimes(1)
    expect(channelOn).toHaveBeenCalledTimes(2)
  })

  it('passes the table and an optional row filter through', () => {
    renderHook(() => useRealtimeRefresh([{ table: 'recipe_ingredients', filter: 'recipe_id=eq.r1' }], () => {}))
    expect(channelOn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: '*', schema: 'public', table: 'recipe_ingredients', filter: 'recipe_id=eq.r1' }),
    )
  })

  it('omits the filter key entirely when none is given', () => {
    renderHook(() => useRealtimeRefresh([{ table: 'food_items' }], () => {}))
    expect(channelOn.mock.calls[0][1]).not.toHaveProperty('filter')
  })

  it('calls onChange when a remote change arrives', () => {
    const onChange = vi.fn()
    renderHook(() => useRealtimeRefresh([{ table: 'food_items' }], onChange))
    emitRealtimeChange()
    expect(onChange).toHaveBeenCalledOnce()
  })

  // The callback is read from a ref, so callers need not memoize it — a new
  // closure each render must not tear down and rebuild the subscription.
  it('uses the latest callback without resubscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onChange }) => useRealtimeRefresh([{ table: 'food_items' }], onChange), {
      initialProps: { onChange: first },
    })
    rerender({ onChange: second })

    expect(channelSubscribe).toHaveBeenCalledTimes(1)
    emitRealtimeChange()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('resubscribes when the watched tables change', () => {
    const { rerender } = renderHook(({ table }) => useRealtimeRefresh([{ table }], () => {}), {
      initialProps: { table: 'food_items' },
    })
    rerender({ table: 'recipes' })
    expect(channelSubscribe).toHaveBeenCalledTimes(2)
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeRefresh([{ table: 'food_items' }], () => {}))
    unmount()
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })
})
