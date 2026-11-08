import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import {
  isDerivative,
  isOfflineApi,
  onlyCacheable,
  stripMediaToken,
} from './src/pwa/cachePlugins.ts'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'generateSW',
      // 등록은 UpdatePrompt 의 virtual:pwa-register/react.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LittleDays',
        short_name: 'LittleDays',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F7F6',
        theme_color: '#F5F7F6',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 앱 셸: 기본 globPatterns(js·css·html) + includeAssets + 매니페스트 아이콘.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/s\//],
        // 규칙 없는 요청은 네트워크 그대로. 두 캐시 모두 로그아웃 시 삭제(auth/session.ts).
        runtimeCaching: [
          {
            // 네트워크 우선. 응답이 있으면 상태 그대로(401 포함), 실패·지연 시에만 캐시.
            urlPattern: isOfflineApi,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ld-api',
              expiration: { maxEntries: 1000, purgeOnQuotaError: true },
              plugins: [{ cacheWillUpdate: onlyCacheable }],
            },
          },
          {
            urlPattern: isDerivative,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ld-derivatives',
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              plugins: [
                { cacheKeyWillBeUsed: stripMediaToken },
                { cacheWillUpdate: onlyCacheable },
              ],
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:18080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    globals: true,
    unstubGlobals: true,
  },
})
