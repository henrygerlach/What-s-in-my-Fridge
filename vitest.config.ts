import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.ts on purpose: the PWA plugin generates a service
// worker and precache manifest, which has no business running during tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/lib/__mocks__/**',
        'src/types/**',
        'src/vite-env.d.ts',
        // Bootstraps a real browser: mounts to #root and registers the
        // service worker. Nothing to assert that isn't the framework's job.
        'src/main.tsx',
        // Workbox service worker; runs in a ServiceWorkerGlobalScope that
        // jsdom does not provide.
        'src/sw.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
