import type { AppPreferences, CliBackend } from '@/types/preferences'
import { DEFAULT_MODEL } from '@/store/chat-store'

export function resolveDefaultModelForBackend(
  backend: CliBackend,
  preferences: AppPreferences | null | undefined
): string {
  if (backend === 'codex') {
    return preferences?.selected_codex_model ?? 'gpt-5.5'
  }
  if (backend === 'opencode') {
    return preferences?.selected_opencode_model ?? 'opencode/gpt-5.3-codex'
  }
  if (backend === 'cursor') {
    return preferences?.selected_cursor_model ?? 'cursor/auto'
  }
  if (backend === 'commandcode') {
    return preferences?.selected_commandcode_model ?? 'commandcode/default'
  }
  return preferences?.selected_model ?? DEFAULT_MODEL
}
