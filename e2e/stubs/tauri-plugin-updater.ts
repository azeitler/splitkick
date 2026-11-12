/**
 * E2E stand-in for `@tauri-apps/plugin-updater`. By default no update is
 * found. A test sets `window.__E2E_UPDATER__ = { version }` (before the app
 * loads) to make `check()` find that version; the fake download reports
 * progress, and every call is recorded in `window.__E2E_UPDATER__.calls`.
 */
interface E2EUpdater {
  version: string
  calls: string[]
}

function updater(): E2EUpdater | undefined {
  return (window as unknown as { __E2E_UPDATER__?: E2EUpdater })
    .__E2E_UPDATER__
}

interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data?: { contentLength?: number; chunkLength?: number }
}

export async function check() {
  const state = updater()
  if (!state) return null
  state.calls ??= []
  state.calls.push('check')
  return {
    version: state.version,
    async download(onEvent: (event: DownloadEvent) => void) {
      state.calls.push('download')
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      for (let i = 0; i < 4; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 150))
        onEvent({ event: 'Progress', data: { chunkLength: 25 } })
      }
      onEvent({ event: 'Finished' })
    },
    async install() {
      state.calls.push('install')
    },
    async close() {
      state.calls.push('close')
    },
  }
}
