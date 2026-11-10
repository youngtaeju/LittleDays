import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { CustomCompiler } from 'unplugin-icons/types'
import Icons from 'unplugin-icons/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import {
  isDerivative,
  isFont,
  isOfflineApi,
  onlyCacheable,
  stripMediaToken,
} from './src/pwa/cachePlugins.ts'

// ~icons/* → React 컴포넌트. 기본 jsx 컴파일러의 svgr 의존성 회피, 빌드 시점 iconify 데이터만 사용.
// 라벨(aria-label·aria-labelledby) 없으면 장식용(aria-hidden), 있으면 role="img". props 가 우선.
const reactIcon: CustomCompiler = {
  extension: 'js',
  compiler: (svg) => {
    const m = /^<svg([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim())
    if (!m) throw new Error(`unexpected icon svg: ${svg.slice(0, 40)}`)
    const attrs: Record<string, string> = {}
    for (const [, k = '', v = ''] of (m[1] ?? '').matchAll(
      /([\w:-]+)="([^"]*)"/g,
    )) {
      attrs[k === 'class' ? 'className' : k] = v
    }
    return `import { createElement } from 'react'
const attrs = ${JSON.stringify(attrs)}
const html = { __html: ${JSON.stringify(m[2] ?? '')} }
export default function Icon(props) {
  const labeled = props['aria-label'] != null || props['aria-labelledby'] != null
  return createElement('svg', {
    ...attrs,
    'aria-hidden': labeled ? undefined : true,
    role: labeled ? 'img' : undefined,
    ...props,
    dangerouslySetInnerHTML: html,
  })
}
`
  },
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    Icons({ compiler: reactIcon }),
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
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
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
        // 글꼴 서브셋(약 90개, 3 MB)은 precache 제외. 쓰는 글자 범위만 ld-fonts 런타임 캐시.
        globIgnores: ['**/*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/s\//],
        // 규칙 없는 요청은 네트워크 그대로. ld-api·ld-derivatives 는 로그아웃 시 삭제(auth/session.ts).
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
          {
            // 파일명에 해시가 들어간 빌드 산출물이라 갱신 불필요.
            urlPattern: isFont,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ld-fonts',
              expiration: { maxEntries: 120, purgeOnQuotaError: true },
              plugins: [{ cacheWillUpdate: onlyCacheable }],
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
    // e2e/*.spec.ts 는 Playwright 전용.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    globals: true,
    unstubGlobals: true,
  },
})
