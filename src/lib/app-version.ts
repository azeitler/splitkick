import { CLIENT_BUILD_INFO } from './build-info'

/**
 * Version of this build: the Splitkick version baked in by vite.config.ts
 * (from src-tauri/tauri.fork.conf.json). Used where the native
 * `getVersion()` is not available or not yet resolved.
 */
export const FALLBACK_APP_VERSION = CLIENT_BUILD_INFO.appVersion
