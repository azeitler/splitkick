import { MODEL_OPTIONS, CODEX_MODEL_OPTIONS, OPENCODE_MODEL_OPTIONS } from './toolbar/toolbar-options'

const ALL_MODEL_OPTIONS = [...MODEL_OPTIONS, ...CODEX_MODEL_OPTIONS, ...OPENCODE_MODEL_OPTIONS]

/**
 * Resolves a human-readable label for the backend + model that will be used
 * when approving a plan in build or yolo mode.
 */
export function resolveApprovalLabel(
  mode: 'build' | 'yolo',
  preferences: {
    build_model?: string | null
    build_backend?: string | null
    yolo_model?: string | null
    yolo_backend?: string | null
    selected_model?: string | null
    default_backend?: string | null
  } | undefined,
): string | null {
  if (!preferences) return null
  const model = mode === 'yolo' ? preferences.yolo_model : preferences.build_model
  const backend = mode === 'yolo' ? preferences.yolo_backend : preferences.build_backend
  const resolvedModel = model ?? preferences.selected_model ?? null
  const resolvedBackend = backend ?? preferences.default_backend ?? 'claude'
  if (!resolvedModel && !resolvedBackend) return null
  const modelLabel = resolvedModel
    ? (ALL_MODEL_OPTIONS.find(o => o.value === resolvedModel)?.label ?? resolvedModel)
    : null
  const parts: string[] = []
  if (resolvedBackend && resolvedBackend !== 'claude') parts.push(resolvedBackend)
  if (modelLabel) parts.push(modelLabel)
  return parts.length > 0 ? parts.join(' · ') : null
}
