import type { RunStatus, SessionDebugInfo, UsageData } from '@/types/chat'

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`
  }
  return tokens.toString()
}

export function formatUsage(usage: UsageData | undefined): string {
  if (!usage) return ''
  return `${formatTokens(usage.input_tokens)} in / ${formatTokens(usage.output_tokens)} out`
}

export function getStatusText(status: RunStatus): string {
  switch (status) {
    case 'crashed':
      return 'completed (recovered)'
    case 'resumable':
      return 'resumable'
    default:
      return status
  }
}

export function formatSessionDebugDetails(params: {
  sessionId: string
  selectedModel?: string
  providerDisplay: string
  debugInfo: SessionDebugInfo
}): string {
  const { sessionId, selectedModel, providerDisplay, debugInfo } = params

  const lines = [
    `session: ${sessionId}`,
    `model: ${selectedModel ?? 'unknown'} / provider: ${providerDisplay}`,
    `sessions file: ${debugInfo.sessions_file}`,
    `runs dir: ${debugInfo.runs_dir}`,
    `manifest: ${debugInfo.manifest_file || 'none'}`,
    `total usage: ${formatUsage(debugInfo.total_usage)}`,
    '',
    `Run logs (${debugInfo.run_log_files.length}):`,
    ...debugInfo.run_log_files.map(
      file =>
        `  ${getStatusText(file.status)} ${file.usage ? `(${formatUsage(file.usage)})` : ''} ${file.user_message_preview}`
    ),
  ]

  return lines.join('\n')
}
