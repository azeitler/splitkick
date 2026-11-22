import { defineConfig, mergeConfig } from 'vite'
import baseConfigFn from '../vite.config'
import path from 'path'

export default defineConfig(async env => {
  const baseConfig = await (baseConfigFn as any)(env)

  return mergeConfig(baseConfig, {
    // Own dependency cache: the normal dev server (port 1420) has another
    // config hash, so a shared cache made each server re-bundle the other's
    // deps (issue #148).
    cacheDir: 'node_modules/.vite-e2e',
    resolve: {
      alias: {
        '@tauri-apps/plugin-dialog': path.resolve(
          __dirname,
          'stubs/tauri-plugin-dialog.ts'
        ),
        '@tauri-apps/plugin-opener': path.resolve(
          __dirname,
          'stubs/tauri-plugin-opener.ts'
        ),
        '@tauri-apps/plugin-updater': path.resolve(
          __dirname,
          'stubs/tauri-plugin-updater.ts'
        ),
        '@tauri-apps/plugin-process': path.resolve(
          __dirname,
          'stubs/tauri-plugin-process.ts'
        ),
        '@tauri-apps/plugin-clipboard-manager': path.resolve(
          __dirname,
          'stubs/tauri-plugin-clipboard.ts'
        ),
      },
    },
  })
})
