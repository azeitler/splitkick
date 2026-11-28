// Types for scripts/web-start-loader.mjs (imported by vite.config.ts and a test).
export const DOWNLOAD_LABEL: string
export const STARTING_LABEL: string
export const START_LOADER_SOURCE: string
export function rewriteIndexHtmlForStartLoader(
  html: string,
  sizeOf: (url: string) => number
): string
