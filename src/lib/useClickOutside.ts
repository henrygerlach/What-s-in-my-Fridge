import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useClickOutside(ref: RefObject<HTMLElement | null>, active: boolean, onOutsideClick: () => void) {
  useEffect(() => {
    if (!active) return

    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutsideClick()
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [active, onOutsideClick, ref])
}
