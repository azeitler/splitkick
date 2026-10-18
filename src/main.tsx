import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import App from './App'
import { queryClient } from './lib/query-client'
import { installGetComposedRangesCompat } from './lib/selection-compat'
import { isNativeApp } from './lib/environment'
import { installNativeContextMenuGuard } from './lib/native-context-menu'

installGetComposedRangesCompat()
// No WebKit Reload menu in app windows; dev builds keep Inspect Element, and
// web access keeps the browser's own menu.
if (isNativeApp() && !import.meta.env.DEV) installNativeContextMenuGuard(window)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <App />
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>
)
