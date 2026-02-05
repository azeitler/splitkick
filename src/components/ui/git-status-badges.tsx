import { ArrowDown, ArrowUp } from 'lucide-react'

interface GitStatusBadgesProps {
  behindCount: number
  unpushedCount: number
  diffAdded: number
  diffRemoved: number
  onPull?: (e: React.MouseEvent) => void
  onPush?: (e: React.MouseEvent) => void
  onDiffClick?: (e: React.MouseEvent) => void
}

export function GitStatusBadges({
  behindCount,
  unpushedCount,
  diffAdded,
  diffRemoved,
  onPull,
  onPush,
  onDiffClick,
}: GitStatusBadgesProps) {
  const hasDiff = diffAdded > 0 || diffRemoved > 0
  if (!behindCount && !unpushedCount && !hasDiff) return null

  return (
    <span className="inline-flex items-center gap-1.5">
      {hasDiff && (
        <button
          type="button"
          onClick={onDiffClick}
          className="shrink-0 cursor-pointer text-[11px] font-medium hover:opacity-70 transition-opacity"
          title={`+${diffAdded}/-${diffRemoved} lines — click to view diff`}
        >
          <span className="text-green-500">+{diffAdded}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-red-500">-{diffRemoved}</span>
        </button>
      )}
      {behindCount > 0 && (
        <button
          type="button"
          onClick={onPull}
          className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
          title={`Pull ${behindCount} commit${behindCount > 1 ? 's' : ''} from remote`}
        >
          <ArrowDown className="h-3 w-3" />
          {behindCount}
        </button>
      )}
      {unpushedCount > 0 && (
        <button
          type="button"
          onClick={onPush}
          className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-medium text-orange-500 transition-colors hover:bg-orange-500/20"
          title={`Push ${unpushedCount} commit${unpushedCount > 1 ? 's' : ''} to remote`}
        >
          <ArrowUp className="h-3 w-3" />
          {unpushedCount}
        </button>
      )}
    </span>
  )
}
