import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App'
import { queryClient } from './lib/query-client'
import { installGetComposedRangesCompat } from './lib/selection-compat'
import { isNativeApp } from './lib/environment'
import { installNativeContextMenuGuard } from './lib/native-context-menu'
import { hydrateRemoteConnections } from './lib/remote-connections'
import { installWebviewLivenessResponder } from './lib/webview-liveness'
import { installWebReloadLog } from './lib/web-reload-log'
import { registerServiceWorker } from './lib/service-worker'

installGetComposedRangesCompat()
// No WebKit Reload menu in app windows; dev builds keep Inspect Element, and
// web access keeps the browser's own menu.
if (isNativeApp() && !import.meta.env.DEV) installNativeContextMenuGuard(window)
// Lets the desktop shell find an empty or hung window and reload it (#97).
installWebviewLivenessResponder()
// Web Access: count how often the page starts again, and why (#72).
installWebReloadLog()

function render() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}

// The desktop shell reads its remote connections from the backend (tokens in
// the Keychain) before the first render: connection windows and the
// transport read them synchronously.
hydrateRemoteConnections()
  .catch(error => {
    console.error('Failed to load remote connections', error)
  })
  .finally(render)

// Web Access: keep the app shell for a fast start, also when the server
// cannot be reached (#72). Registers after load, so it never slows the start.
if (document.readyState === 'complete') void registerServiceWorker()
else
  window.addEventListener('load', () => void registerServiceWorker(), {
    once: true,
  })
