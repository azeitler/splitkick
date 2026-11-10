import { toast } from 'sonner'
import {
  CLIENT_BUILD_INFO,
  CLIENT_WEB_BUILD_ID,
  PRODUCT_NAME,
} from '@/lib/build-info'
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'
import { getActiveRemoteConnection } from '@/lib/remote-connections'
import { updateServiceWorkerAndReload } from '@/lib/service-worker'

interface ServerBuildInfo {
  webBuildId?: string | null
  appVersion?: string | null
}

let notifiedServerBuildId: string | null = null

/**
 * Warn browser-mode users when their loaded JS bundle is older than the
 * frontend currently served by Jean Web Access.
 */
export function checkWebClientVersion(serverInfo: ServerBuildInfo): boolean {
  if (isNativeApp()) return false

  const serverBuildId = serverInfo.webBuildId
  if (!serverBuildId || serverBuildId === CLIENT_WEB_BUILD_ID) return false
  // Web Access on a remote connection runs this page's frontend against
  // another server. A reload loads this host's frontend again, so it cannot
  // close the gap; the toast would come back after each reload.
  if (getActiveRemoteConnection()) return false

  if (notifiedServerBuildId === serverBuildId) return true
  notifiedServerBuildId = serverBuildId

  logger.warn('Stale web access client detected', {
    clientBuildId: CLIENT_WEB_BUILD_ID,
    serverBuildId,
    clientVersion: CLIENT_BUILD_INFO.appVersion,
    serverVersion: serverInfo.appVersion,
  })

  toast.warning(`${PRODUCT_NAME} was updated`, {
    id: 'web-client-stale',
    description: serverInfo.appVersion
      ? `Reload Web Access to use ${PRODUCT_NAME} ${serverInfo.appVersion} and the latest features.`
      : 'Reload Web Access to use the latest features.',
    duration: Infinity,
    closeButton: false,
    action: {
      label: 'Reload',
      onClick: () => void updateServiceWorkerAndReload(),
    },
  })

  return true
}
