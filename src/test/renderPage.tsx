import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../lib/ToastContext'

// Pages assume a router and the toast provider above them, and several read
// route params. This mounts one the way App.tsx does. Navigation is observed
// through the real router rather than by stubbing useNavigate, so a page's
// redirect is asserted the way the user would experience it.

let location: { pathname: string; state: unknown } = { pathname: '/', state: null }

function LocationProbe() {
  const current = useLocation()
  location = { pathname: current.pathname, state: current.state }
  return null
}

export function currentPath(): string {
  return location.pathname
}

export function currentState(): unknown {
  return location.state
}

interface RenderPageOptions {
  // The route pattern the page is mounted at, e.g. '/recipes/:id'.
  path?: string
  // The entry to start at, e.g. '/recipes/r1'.
  route?: string
  // Router location state, for pages prefilled by another page.
  state?: unknown
}

export function renderPage(ui: ReactElement, { path = '/', route = '/', state }: RenderPageOptions = {}) {
  location = { pathname: route, state: state ?? null }
  return render(
    <MemoryRouter initialEntries={[{ pathname: route, state }]}>
      <ToastProvider>
        <LocationProbe />
        <Routes>
          <Route path={path} element={ui} />
          {/* Any route the page navigates to renders as a blank page; the
              probe above still records where it went. */}
          <Route path="*" element={null} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

// A File whose contents never matter, since image decoding is mocked out.
export function imageFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['binary'], name, { type })
}
