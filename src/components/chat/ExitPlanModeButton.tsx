import type { ToolCall } from '@/types/chat'
import { isAskUserQuestion, isExitPlanMode } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

interface ExitPlanModeButtonProps {
  toolCalls: ToolCall[] | undefined
  /** Whether the plan has been approved (from message.plan_approved) */
  isApproved: boolean
  /** Whether this is the latest message with ExitPlanMode (only latest shows Approve button) */
  isLatestPlanRequest?: boolean
  /** Whether a user message follows this plan (means user sent a new message instead of approving) */
  hasFollowUpMessage?: boolean
  onPlanApproval?: () => void
  /** Callback for approving with yolo mode (auto-approve all future tools) */
  onPlanApprovalYolo?: () => void
  /** Ref to attach to the approve button for visibility tracking */
  buttonRef?: React.RefObject<HTMLButtonElement | null>
  /** Keyboard shortcut to display on the button */
  shortcut?: string
  /** Keyboard shortcut to display on the yolo button */
  shortcutYolo?: string
  /** Hide approve buttons (e.g. for Codex which has no native approval flow) */
  hideApproveButtons?: boolean
}

/**
 * Standalone component for ExitPlanMode approval button
 * Rendered separately from ToolCallsDisplay so it appears after content
 * Also displays the plan file content if a Write to ~/.claude/plans/*.md was found
 *
 * Note: Not memoized - the component is lightweight and memoization was causing
 * callback prop issues where stale undefined callbacks would be captured
 */
export function ExitPlanModeButton({
  toolCalls,
  isApproved,
  isLatestPlanRequest = true,
  hasFollowUpMessage = false,
  onPlanApproval,
  onPlanApprovalYolo,
  buttonRef,
  shortcut,
  shortcutYolo,
  hideApproveButtons,
}: ExitPlanModeButtonProps) {
  if (!toolCalls) return null

  const exitPlanTools = toolCalls.filter(isExitPlanMode)

  // Use last tool (Claude may call ExitPlanMode multiple times)
  const tool = exitPlanTools[exitPlanTools.length - 1]
  if (!tool) return null

  // Don't show approve button if there are questions to answer first
  const hasQuestions = toolCalls.some(isAskUserQuestion)
  if (hasQuestions && !isApproved) return null

  // Don't show button if already approved, not latest, has follow-up, or hidden (Codex)
  if (isApproved || !isLatestPlanRequest || hasFollowUpMessage || hideApproveButtons) return null

  // Only render the approve button (plan is shown inline in timeline)
  return (
    <div className="mt-3 flex gap-2">
      <Button ref={buttonRef} onClick={() => onPlanApproval?.()}>
        Approve
        {shortcut && (
          <Kbd className="ml-1.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
            {shortcut}
          </Kbd>
        )}
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          onPlanApprovalYolo?.()
        }}
      >
        Approve (yolo)
        {shortcutYolo && (
          <Kbd className="ml-1.5 h-4 text-[10px] bg-destructive-foreground/20 text-destructive-foreground">
            {shortcutYolo}
          </Kbd>
        )}
      </Button>
    </div>
  )
}
