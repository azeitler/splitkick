// Types for scripts/web-start-loader.mjs (imported by vite.config.ts and a test).
export const DOWNLOAD_LABEL: string
export const STARTING_LABEL: string
export const SLOW_HINT_MS: number
export const START_LOADER_SOURCE: string
export function rewriteIndexHtmlForStartLoader(
  html: string,
  sizeOf: (url: string) => number
): string
