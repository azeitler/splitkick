import type { PrDisplayStatus } from '@/types/pr-status'

export function getPrStatusDisplay(status: PrDisplayStatus): {
  label: string
  className: string
} {
  switch (status) {
    case 'draft':
      return { label: 'Draft', className: 'text-muted-foreground' }
    case 'open':
      return { label: 'Open', className: 'text-green-600 dark:text-green-500' }
    case 'merged':
      return {
        label: 'Merged',
        className: 'text-purple-600 dark:text-purple-400',
      }
    case 'closed':
      return { label: 'Closed', className: 'text-red-600 dark:text-red-400' }
    default:
      return { label: 'Unknown', className: 'text-muted-foreground' }
  }
}

export function getProviderDisplayName(selectedProvider: string | null): string {
  return !selectedProvider || selectedProvider === '__anthropic__'
    ? 'Anthropic'
    : selectedProvider
}

function formatProviderName(provider: string): string {
  const knownProviders: Record<string, string> = {
    anthropic: 'Anthropic',
    opencode: 'OpenCode',
    openai: 'OpenAI',
    google: 'Google',
    moonshotai: 'Moonshot AI',
    minimax: 'MiniMax',
    xai: 'xAI',
  }
  return (
    knownProviders[provider.toLowerCase()] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  )
}

function formatModelToken(token: string): string {
  const knownTokens: Record<string, string> = {
    claude: 'Claude',
    gpt: 'GPT',
    glm: 'GLM',
    kimi: 'Kimi',
    codex: 'Codex',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    opus: 'Opus',
    minimax: 'MiniMax',
    trinity: 'Trinity',
    latest: 'Latest',
    preview: 'Preview',
    turbo: 'Turbo',
    thinking: 'Thinking',
    flash: 'Flash',
    nano: 'Nano',
    mini: 'Mini',
    max: 'Max',
    large: 'Large',
    free: 'Free',
    pro: 'Pro',
  }

  const lower = token.toLowerCase()
  if (knownTokens[lower]) return knownTokens[lower]
  if (/^\d+(\.\d+)*$/.test(token)) return token
  if (/^[a-z]{1,3}$/i.test(token)) return token.toUpperCase()
  return token.charAt(0).toUpperCase() + token.slice(1)
}

export function formatOpencodeModelLabel(raw: string): string {
  const [provider, model] = raw.split('/')
  if (!provider || !model) return raw

  const rawTokens = model.split('-').filter(Boolean)
  const mergedTokens: string[] = []
  for (let i = 0; i < rawTokens.length; i++) {
    const current = rawTokens[i]
    if (!current) continue
    const next = rawTokens[i + 1]
    // Render version pairs like 4-5 -> 4.5, 3-7 -> 3.7
    if (/^\d$/.test(current) && /^\d$/.test(next ?? '')) {
      mergedTokens.push(`${current}.${next}`)
      i++
      continue
    }
    mergedTokens.push(current)
  }

  const modelLabel = mergedTokens
    .filter(Boolean)
    .map(formatModelToken)
    .join(' ')

  return `${modelLabel} (${formatProviderName(provider)})`
}
