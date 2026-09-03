import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// This module is a side-effecting singleton, so each case re-imports it with
// a different environment rather than sharing one instance.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('supabase client', () => {
  it('is constructed when both variables are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    const { supabase } = await import('./supabase')
    expect(supabase).toBeDefined()
    expect(typeof supabase.from).toBe('function')
  })

  // Failing at import time with a named message is deliberate: a missing key
  // otherwise surfaces as an opaque network error on the first query.
  it('fails fast and names the fix when the URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    await expect(import('./supabase')).rejects.toThrow(/Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY/)
  })

  it('fails fast when the anon key is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('./supabase')).rejects.toThrow(/Copy \.env\.example to \.env/)
  })
})
