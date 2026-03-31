import { Button } from '@/components/ui/button'
import type { CodexCommandApprovalRequest } from '@/types/chat'

interface CodexCommandApprovalRequestProps {
  request: CodexCommandApprovalRequest
  onApprove: () => void
  onApproveYolo: () => void
  onDecline: () => void
  onCancel?: () => void
}

export function CodexCommandApprovalRequestCard({
  request,
  onApprove,
  onApproveYolo,
  onDecline,
  onCancel,
}: CodexCommandApprovalRequestProps) {
  return (
    <div className="my-3 rounded border border-muted bg-muted/30 p-4 font-mono text-sm">
      <div className="mb-2 font-semibold">Codex wants to run a command</div>
      {request.reason ? (
        <div className="mb-3 text-muted-foreground">{request.reason}</div>
      ) : null}

      {request.command ? (
        <pre className="mb-3 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
          {request.command}
        </pre>
      ) : null}

      <div className="space-y-2 text-xs text-muted-foreground">
        {request.cwd ? (
          <div>
            <div className="font-medium text-foreground">Working directory</div>
            <div>{request.cwd}</div>
          </div>
        ) : null}
        {request.network_approval_context ? (
          <div>
            <div className="font-medium text-foreground">Network</div>
            <div>
              {request.network_approval_context.protocol}://
              {request.network_approval_context.host}
            </div>
          </div>
        ) : null}
        {request.command_actions?.length ? (
          <div>
            <div className="font-medium text-foreground">Detected actions</div>
            <ul className="list-disc space-y-1 pl-4">
              {request.command_actions.map((action, index) => (
                <li key={`${action.command}-${index}`}>
                  {action.type}
                  {action.path ? ` · ${action.path}` : ''}
                  {action.query ? ` · ${action.query}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onApprove}>
          Approve
        </Button>
        <Button size="sm" variant="destructive" onClick={onApproveYolo}>
          Approve (yolo)
        </Button>
        <Button size="sm" variant="secondary" onClick={onDecline}>
          Decline
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel turn
          </Button>
        ) : null}
      </div>
    </div>
  )
}
