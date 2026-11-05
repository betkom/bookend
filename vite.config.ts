/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./app'),
  // Relative base so the build works on GitHub Pages sub-paths and Netlify alike.
  base: './',
  publicDir: r('./app/public'),
  resolve: {
    alias: { '@importers': r('./importers') },
  },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Bookend',
        short_name: 'Bookend',
        description: 'Every book you read or heard, in one log.',
        theme_color: '#f6f2ee',
        background_color: '#f6f2ee',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [
          {
            // Cache Open Library covers so they work offline (needed later for recap cards).
            urlPattern: /^https:\/\/covers\.openlibrary\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ol-covers',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    root: r('.'),
    include: ['importers/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
  },
});

