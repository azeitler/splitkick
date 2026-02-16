export interface ProcessInfo {
  pid: number
  sessionId: string
  cpuUsage: number
  memoryMb: number
  uptimeSeconds: number
}

export interface AppProcessInfo {
  pid: number
  name: string
  cpuUsage: number
  memoryMb: number
}

export interface PollingStatus {
  isFocused: boolean
  activeWorktreeId: string | null
  gitPollIntervalSecs: number
  remotePollIntervalSecs: number
  lastLocalPollAgoSecs: number | null
  lastRemotePollAgoSecs: number | null
  prSweepCount: number
  gitSweepCount: number
}

export interface DiagnosticsSnapshot {
  appProcesses: AppProcessInfo[]
  appTotalCpu: number
  appTotalMemoryMb: number
  runningProcesses: ProcessInfo[]
  cliTotalCpu: number
  cliTotalMemoryMb: number
  pollingStatus: PollingStatus
  activeTailerCount: number
}
