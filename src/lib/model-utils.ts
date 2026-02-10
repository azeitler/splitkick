/**
 * Model utilities for feature detection and CLI compatibility.
 *
 * Opus 4.6 introduces adaptive thinking (effort parameter) replacing
 * traditional thinking levels (budget_tokens). This is supported from
 * Claude CLI >= 2.1.32.
 */

import { compareVersions } from './version-utils'

/** Minimum CLI version that supports Opus 4.6 and adaptive thinking */
const ADAPTIVE_THINKING_MIN_CLI_VERSION = '2.1.32'

/**
 * Check if the current model + CLI version combination supports
 * adaptive thinking (effort parameter) instead of traditional thinking levels.
 *
 * Returns true when:
 * - Model is 'opus' (latest, which is 4.6 on CLI >= 2.1.32)
 * - CLI version is >= 2.1.32
 */
export function supportsAdaptiveThinking(
  model: string,
  cliVersion: string | null | undefined
): boolean {
  if (model !== 'opus') return false
  if (!cliVersion) return false
  return compareVersions(cliVersion, ADAPTIVE_THINKING_MIN_CLI_VERSION) >= 0
}
