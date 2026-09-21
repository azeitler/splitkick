import { memo, useEffect, useState } from 'react'
import { ChevronRight, Github, Heart } from 'lucide-react'
import { BackendLabel } from '@/components/ui/backend-label'
import { useUIStore } from '@/store/ui-store'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { FALLBACK_APP_VERSION } from '@/lib/app-version'
import { releaseUrlForVersion } from '@/lib/release-url'
import { getMobileNavigationGroups } from '@/components/preferences/preferences-navigation'
import {
  CliUpdatesIndicator,
  ServerUpdateIndicator,
  UpdateIndicator,
} from '@/components/titlebar/TitleBar'
import { RemoteConnectionsDialog } from '@/components/remote/RemoteConnectionsDialog'
import { useHasPendingUpdate } from './mobile-nav-utils'
import { MobileTabPage, MobileTabSection } from './MobileTabPage'

/** A tappable row in a grouped list. */
function SettingsRow({
  children,
  onClick,
  testId,
}: {
  children: React.ReactNode
  onClick: () => void
  testId?: string
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors active:bg-accent/60"
      >
        {children}
        <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

const LIST_CLASS =
  'flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border bg-muted/20'

function useAppVersion(): string {
  const [version, setVersion] = useState(FALLBACK_APP_VERSION)
  useEffect(() => {
    if (!isNativeApp()) return
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined)
  }, [])
  return version
}

/**
 * The Settings page, pushed over Home by its gear button.
 *
 * Pending updates first, then every Preferences pane a phone can use — each
 * row opens the full-screen Preferences dialog on that pane, which is a portal
 * and so lands above this page — then About. Usage has a tab of its own.
 *
 * Rendered inside the shell rather than as a portal sheet for that reason: a
 * sheet would share the dialog's layer and could cover it.
 */
export const MobileSettingsPage = memo(function MobileSettingsPage({
  onClose,
}: {
  onClose: () => void
}) {
  const updateAvailable = useHasPendingUpdate()
  const version = useAppVersion()
  const groups = getMobileNavigationGroups()
  const { containerRef, isSwiping, translateX, transitionStyle } = useSwipeBack(
    { onSwipeBack: onClose }
  )

  return (
    <div
      ref={containerRef}
      data-testid="mobile-settings-page"
      className="absolute inset-0 z-[2] bg-background motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-300 motion-safe:ease-out"
      style={
        isSwiping || translateX !== 0
          ? {
              transform: `translateX(${translateX}px)`,
              transition: transitionStyle || undefined,
            }
          : undefined
      }
    >
      <MobileTabPage title="Settings" testId="mobile-settings" onBack={onClose}>
        {updateAvailable && (
          <MobileTabSection title="Updates">
            <div
              className="flex flex-wrap items-center gap-y-2 rounded-xl border bg-muted/20 p-3"
              data-testid="mobile-settings-updates"
            >
              <UpdateIndicator />
              <ServerUpdateIndicator />
              <CliUpdatesIndicator />
            </div>
          </MobileTabSection>
        )}

        {groups.map(group => (
          <MobileTabSection key={group.id} title={group.label}>
            <ul className={LIST_CLASS}>
              {group.items.map(item => (
                <SettingsRow
                  key={item.id}
                  testId={`mobile-settings-pane-${item.id}`}
                  onClick={() =>
                    useUIStore.getState().openPreferencesPane(item.id)
                  }
                >
                  <item.icon className="size-4 shrink-0 text-muted-foreground" />
                  {item.backend ? (
                    <BackendLabel backend={item.backend} />
                  ) : (
                    <span>{item.name}</span>
                  )}
                </SettingsRow>
              ))}
            </ul>
          </MobileTabSection>
        ))}

        <MobileTabSection title="About">
          <ul className={LIST_CLASS}>
            <SettingsRow
              onClick={() => openExternal(releaseUrlForVersion(version))}
            >
              <span>Version</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                v{version}
              </span>
            </SettingsRow>
            <SettingsRow
              onClick={() => openExternal('https://github.com/coollabsio/jean')}
            >
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <span>GitHub</span>
            </SettingsRow>
            <SettingsRow
              onClick={() => openExternal('https://jean.build/sponsorships/')}
            >
              <Heart className="size-4 shrink-0 text-pink-500" />
              <span>Sponsor</span>
            </SettingsRow>
          </ul>
          {/* Remote connections exist only in the native shell. */}
          {isNativeApp() && (
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              Connections <RemoteConnectionsDialog />
            </div>
          )}
        </MobileTabSection>
      </MobileTabPage>
    </div>
  )
})
