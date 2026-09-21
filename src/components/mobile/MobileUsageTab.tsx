import { memo } from 'react'
import { UsagePane } from '@/components/preferences/panes/UsagePane'
import { MobileTabPage } from './MobileTabPage'

/**
 * The Usage tab: plan usage of every signed-in backend, and nothing else —
 * the same pane the desktop title-bar usage badge opens.
 */
export const MobileUsageTab = memo(function MobileUsageTab() {
  return (
    <MobileTabPage title="Usage" testId="mobile-tab-usage">
      <div
        className="rounded-xl border bg-muted/20 p-3"
        data-testid="mobile-usage-pane"
      >
        <UsagePane withSectionIds={false} />
      </div>
    </MobileTabPage>
  )
})
