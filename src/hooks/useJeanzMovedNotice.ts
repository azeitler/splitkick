import { useEffect } from 'react'
import { toast } from 'sonner'
import { PRODUCT_NAME } from '@/lib/build-info'
import { isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'

const SEEN_KEY = 'jeanz-moved-to-splitkick-notice'
const DOWNLOAD_URL = 'https://splitkick.app'

/**
 * JeanZ 0.1.73-z.26 is the last JeanZ build. Tell the user once that it
 * continues as Splitkick, a separate app with its own data folder that can
 * import JeanZ's data on first start.
 */
export function useJeanzMovedNotice() {
  useEffect(() => {
    if (PRODUCT_NAME !== 'JeanZ' || !isNativeApp()) return
    if (localStorage.getItem(SEEN_KEY)) return
    localStorage.setItem(SEEN_KEY, new Date().toISOString())
    toast.info('JeanZ is now Splitkick', {
      description:
        'This is the last JeanZ build; it gets no more updates. Splitkick installs next to JeanZ and imports your projects and sessions on first start.',
      duration: Infinity,
      action: {
        label: 'Get Splitkick',
        onClick: () => void openExternal(DOWNLOAD_URL),
      },
    })
  }, [])
}
