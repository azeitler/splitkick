/**
 * Reason shown on a disabled action that opens something on the backend host
 * (Finder, terminal, editor). Visible without hover, so phones show it too
 * (#89, docs/developer/remote-capabilities.md).
 */
export const HOST_ONLY_REASON = 'Host only'

export function HostOnlyHint() {
  return (
    <span className="ml-auto shrink-0 whitespace-nowrap pl-3 text-xs text-muted-foreground">
      {HOST_ONLY_REASON}
    </span>
  )
}
