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

installGetComposedRangesCompat()
// No WebKit Reload menu in app windows; dev builds keep Inspect Element, and
// web access keeps the browser's own menu.
if (isNativeApp() && !import.meta.env.DEV) installNativeContextMenuGuard(window)
// Lets the desktop shell find an empty or hung window and reload it (#97).
installWebviewLivenessResponder()

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
