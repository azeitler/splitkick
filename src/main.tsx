import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App'
import { queryClient } from './lib/query-client'

// In dev mode, forward all console.* calls to Tauri's log plugin (→ log file).
// Note: Don't use attachConsole() here — the Webview log target already pipes
// Rust logs into the browser console. Adding attachConsole() would create an
// infinite loop: console override → plugin → Webview → console override → ...
if (import.meta.env.DEV) {
  import('@tauri-apps/plugin-log').then(({ trace, info, warn, error, debug }) => {
    const stringify = (...args: unknown[]) =>
      args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')

    let forwarding = false
    const forward = (fn: (msg: string) => Promise<void>, orig: (...args: unknown[]) => void, args: unknown[]) => {
      orig(...args)
      if (!forwarding) {
        forwarding = true
        fn(stringify(...args)).finally(() => { forwarding = false })
      }
    }

    const origLog = console.log
    const origInfo = console.info
    const origWarn = console.warn
    const origError = console.error
    const origDebug = console.debug

    console.log = (...args: unknown[]) => forward(trace, origLog, args)
    console.info = (...args: unknown[]) => forward(info, origInfo, args)
    console.warn = (...args: unknown[]) => forward(warn, origWarn, args)
    console.error = (...args: unknown[]) => forward(error, origError, args)
    console.debug = (...args: unknown[]) => forward(debug, origDebug, args)
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <App />
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>
)
