import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    preview: {
      // Requests behind a reverse proxy (e.g. `tailscale serve`) keep the
      // original hostname in the Host header, which Vite rejects by default.
      // Set VITE_ALLOWED_HOST in .env to that hostname if needed.
      allowedHosts: env.VITE_ALLOWED_HOST ? [env.VITE_ALLOWED_HOST] : undefined,
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['favicon.svg', 'favicon.ico'],
        manifest: {
          name: "What's in my Fridge?",
          short_name: 'Fridge',
          description:
            'Vorrat im Blick behalten, Rezepte abgleichen und LLM-Vorschläge aus vorhandenen Zutaten erhalten.',
          theme_color: '#863bff',
          background_color: '#ede6ff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          // Keep the default template's max-file-size skip so heic2any's
          // large chunk doesn't fail precaching; it's lazy-loaded anyway.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
  }
})
