const silentReadyIds = new Set<string>()

export function markWorktreeSilentReady(id: string): void {
  silentReadyIds.add(id)
}

export function consumeWorktreeSilentReady(id: string): boolean {
  return silentReadyIds.delete(id)
}
