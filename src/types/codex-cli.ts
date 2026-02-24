/**
 * Types for Codex CLI management
 */

export interface CodexCliStatus {
  installed: boolean
  version: string | null
  path: string | null
}

export interface CodexAuthStatus {
  authenticated: boolean
  error: string | null
}

export interface CodexReleaseInfo {
  version: string
  tagName: string
  publishedAt: string
  prerelease: boolean
}

export interface CodexInstallProgress {
  stage:
    | 'starting'
    | 'downloading'
    | 'extracting'
    | 'installing'
    | 'verifying'
    | 'complete'
  message: string
  percent: number
}
