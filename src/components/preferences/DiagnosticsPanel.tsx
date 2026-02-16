import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { Badge } from '@/components/ui/badge'
import type { DiagnosticsSnapshot } from '@/types/diagnostics'

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatAgo(seconds: number | null): string {
  if (seconds === null) return 'never'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

export function DiagnosticsPanel() {
  const { data: snapshot } = useQuery({
    queryKey: ['diagnostics-snapshot'],
    queryFn: () => invoke<DiagnosticsSnapshot>('get_diagnostics_snapshot'),
    refetchInterval: 3000,
    staleTime: 2000,
  })

  if (!snapshot) {
    return (
      <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
    )
  }

  const {
    appProcesses,
    appTotalCpu,
    appTotalMemoryMb,
    runningProcesses,
    cliTotalCpu,
    cliTotalMemoryMb,
    pollingStatus,
    activeTailerCount,
  } = snapshot

  return (
    <div className="space-y-4 text-sm">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
          App: {appTotalCpu.toFixed(1)}% CPU / {appTotalMemoryMb} MB
        </Badge>
        <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
          CLI: {cliTotalCpu.toFixed(1)}% CPU / {cliTotalMemoryMb} MB
        </Badge>
        <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
          Tailers: {activeTailerCount}
        </Badge>
        <Badge
          variant={pollingStatus.isFocused ? 'default' : 'secondary'}
          className="gap-1.5 px-2.5 py-1"
        >
          {pollingStatus.isFocused ? 'Focused' : 'Unfocused'}
        </Badge>
      </div>

      {/* Jean App Processes (main + WebKit renderer) */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Jean App Processes
        </h4>
        {appProcesses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          <div className="space-y-1.5">
            {appProcesses.map(proc => (
              <div
                key={proc.pid}
                className="flex items-center justify-between rounded border px-3 py-2"
              >
                <span className="text-xs truncate">{proc.name}</span>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  <span>{proc.cpuUsage.toFixed(1)}% CPU</span>
                  <span>{proc.memoryMb} MB</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claude CLI Processes */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Claude CLI Processes
        </h4>
        {runningProcesses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active processes</p>
        ) : (
          <div className="space-y-1.5">
            {runningProcesses.map(proc => (
              <div
                key={proc.pid}
                className="flex items-center justify-between rounded border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                    PID {proc.pid}
                  </span>
                  <span className="text-xs font-mono truncate">
                    {proc.sessionId}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  <span>{proc.cpuUsage.toFixed(1)}% CPU</span>
                  <span>{proc.memoryMb} MB</span>
                  <span>{formatUptime(proc.uptimeSeconds)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Background Polling */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Background Polling
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <Row label="Git poll interval" value={`${pollingStatus.gitPollIntervalSecs}s`} />
          <Row label="Last git poll" value={formatAgo(pollingStatus.lastLocalPollAgoSecs)} />
          <Row label="PR poll interval" value={`${pollingStatus.remotePollIntervalSecs}s`} />
          <Row label="Last PR poll" value={formatAgo(pollingStatus.lastRemotePollAgoSecs)} />
          <Row label="PR sweep worktrees" value={String(pollingStatus.prSweepCount)} />
          <Row label="Git sweep worktrees" value={String(pollingStatus.gitSweepCount)} />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
