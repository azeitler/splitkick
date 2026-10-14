import { isNativeApp } from '@/lib/environment'
import { SidebarToggleButton } from '@/components/toolbar/WindowToolbar'

/**
 * Top of the sidebar column, level with the window toolbar. On macOS the
 * traffic lights sit in its free left part; the sidebar toggle sits right.
 */
export function SidebarHeader() {
  const drag = isNativeApp() ? { 'data-tauri-drag-region': true } : {}
  return (
    <div
      {...drag}
      data-testid="sidebar-header"
      className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-end px-2"
    >
      <SidebarToggleButton />
    </div>
  )
}
