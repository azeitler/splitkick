import { isNativeApp } from '@/lib/environment'
import { invoke, listenLocal } from '@/lib/transport'
import { queryClient } from '@/lib/query-client'

/** Event the desktop shell sends to check that this page still runs (#97). */
export const LIVENESS_PING_EVENT = 'webview-liveness-ping'

/** The note the shell left when it reloaded this window. */
export interface WebviewRecoveryNote {
  reason: string
  /** Unix time in milliseconds. */
  at: number
  /** Text for "Copy details". */
  details: string
}

let recovery: Promise<WebviewRecoveryNote | null> | null = null

/**
 * The recovery note for this page load, or null after a normal start. The
 * shell hands it out once, so every caller shares the same request.
 */
export function takeWebviewRecovery(): Promise<WebviewRecoveryNote | null> {
  if (!isNativeApp()) return Promise.resolve(null)
  recovery ??= invoke<WebviewRecoveryNote | null>(
    'take_webview_recovery'
  ).catch(() => null)
  return recovery
}

/** Chat messages in the query cache and their text size (#128). */
function cachedMessageStats() {
  let messages = 0
  let messageChars = 0
  for (const query of queryClient.getQueryCache().getAll()) {
    const data = query.state.data as
      | {
          messages?: {
            content?: string
            tool_calls?: { output?: string }[]
          }[]
        }
      | undefined
    if (!Array.isArray(data?.messages)) continue
    messages += data.messages.length
    for (const message of data.messages) {
      messageChars += message.content?.length ?? 0
      for (const tool of message.tool_calls ?? []) {
        messageChars += tool.output?.length ?? 0
      }
    }
  }
  return { messages, messageChars }
}

/** What the page tells the shell with each answer. */
export function livenessAnswer(doc: Document = document) {
  return {
    // The React tree is gone when the root is empty: the shell reloads then.
    rendered: (doc.getElementById('root')?.childElementCount ?? 0) > 0,
    stats: {
      queries: queryClient.getQueryCache().getAll().length,
      domNodes: doc.getElementsByTagName('*').length,
      ...cachedMessageStats(),
    },
  }
}

/**
 * Answer the desktop shell's liveness pings. A window that does not answer
 * twice in a row is reloaded (src-tauri/src/webview_watchdog.rs). Installed
 * before the first render, so the answer does not depend on any screen.
 */
export function installWebviewLivenessResponder(): void {
  if (!isNativeApp()) return
  void listenLocal(LIVENESS_PING_EVENT, () => {
    void invoke('webview_liveness_pong', livenessAnswer()).catch(() => {
      // The shell treats a missing answer as the signal; nothing to do here.
    })
  })
}
