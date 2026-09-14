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
    __JEAN_PRODUCT_NAME__: JSON.stringify('Jean'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
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