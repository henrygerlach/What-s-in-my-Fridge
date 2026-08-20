import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface ToastAction {
  label: string
  onAction: () => void
}

interface ToastState {
  id: number
  message: string
  action?: ToastAction
}

type ShowToast = (message: string, action?: ToastAction, durationMs?: number) => void

const ToastContext = createContext<ShowToast | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const showToast = useCallback<ShowToast>((message, action, durationMs = 5000) => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    const id = Date.now()
    setToast({ id, message, action })
    timeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, durationMs)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 z-50 mx-auto flex max-w-screen-sm items-center justify-between gap-3
                     rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        >
          <span className="min-w-0">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-white underline underline-offset-4"
              onClick={() => {
                if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
                toast.action?.onAction()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const showToast = useContext(ToastContext)
  if (!showToast) throw new Error('useToast must be used within a ToastProvider')
  return showToast
}
