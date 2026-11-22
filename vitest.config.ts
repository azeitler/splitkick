import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // vite.config.ts bakes these in at build time. Tests need them too, or any
  // import of src/lib/build-info.ts throws.
  define: {
    __JEAN_WEB_BUILD_INFO__: JSON.stringify({
      webBuildId: 'test-build',
      appVersion: '0.0.0-test',
    }),
    __JEAN_PRODUCT_NAME__: JSON.stringify('Splitkick'),
    __JEAN_UPSTREAM_VERSION__: JSON.stringify('0.1.73'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Many UI tests click through whole dialogs. That is CPU work (jsdom,
    // *ByRole queries), 1-4 s on an idle full run and 4-5x more under load
    // (release gate with Rust builds, emulators). 5 s timed them out at
    // random (issue #148). findBy*/waitFor keep their own 1 s limit, so a
    // wrong state still fails fast; only a hang waits the full 15 s.
    testTimeout: 15_000,
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      'src-tauri',
      '.git',
      '.cache',
      'build',
    ],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})