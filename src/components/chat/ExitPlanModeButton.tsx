import type { ToolCall } from '@/types/chat'
import { isAskUserQuestion, isExitPlanMode } from '@/types/chat'
import { usePreferences } from '@/services/preferences'
import { resolveApprovalLabel } from './approval-label-utils'
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
  /** Callback for clear context approval (new session with plan in yolo mode) */
  onClearContextApproval?: () => void
  /** Callback for clear context approval (new session with plan in build mode) */
  onClearContextBuildApproval?: () => void
  /** Ref to attach to the approve button for visibility tracking */
  buttonRef?: React.RefObject<HTMLButtonElement | null>
  /** Keyboard shortcut to display on the button */
  shortcut?: string
  /** Keyboard shortcut to display on the yolo button */
  shortcutYolo?: string
  /** Keyboard shortcut to display on the clear context button */
  shortcutClearContext?: string
  /** Keyboard shortcut to display on the clear context build button */
  shortcutClearContextBuild?: string
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
  onClearContextApproval,
  onClearContextBuildApproval,
  buttonRef,
  shortcut,
  shortcutYolo,
  shortcutClearContext,
  shortcutClearContextBuild,
  hideApproveButtons,
}: ExitPlanModeButtonProps) {
  const { data: preferences } = usePreferences()
  const buildLabel = resolveApprovalLabel('build', preferences)
  const yoloLabel = resolveApprovalLabel('yolo', preferences)

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
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        <Button ref={buttonRef} variant="outline" size="sm" className="h-auto py-2 !bg-primary/80 !border-primary !text-primary-foreground hover:!bg-primary/90" onClick={() => onPlanApproval?.()}>
          Approve
          {shortcut && (
            <Kbd className="ml-1.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
              {shortcut}
            </Kbd>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-auto py-2 !bg-destructive !border-destructive !text-white hover:!bg-destructive/90 dark:!bg-destructive/60"
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
      {(onClearContextBuildApproval || onClearContextApproval) && (
        <div className="flex flex-wrap gap-2">
          {onClearContextBuildApproval && (
            <Button
              variant="outline"
              size="sm"
              className="h-auto py-2 !bg-primary/80 !border-primary !text-primary-foreground hover:!bg-primary/90"
              onClick={() => onClearContextBuildApproval()}
            >
              <span className="flex flex-col items-center">
                <span className="flex items-center gap-1.5">
                  Clear Context & Approve
                  {shortcutClearContextBuild && (
                    <Kbd className="h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
                      {shortcutClearContextBuild}
                    </Kbd>
                  )}
                </span>
                {buildLabel && (
                  <span className="text-[10px] opacity-70">{buildLabel}</span>
                )}
              </span>
            </Button>
          )}
          {onClearContextApproval && (
            <Button
              variant="outline"
              size="sm"
              className="h-auto py-2 !bg-destructive !border-destructive !text-white hover:!bg-destructive/90 dark:!bg-destructive/60"
              onClick={() => onClearContextApproval()}
            >
              <span className="flex flex-col items-center">
                <span className="flex items-center gap-1.5">
                  Clear Context & Approve (yolo)
                  {shortcutClearContext && (
                    <Kbd className="h-4 text-[10px] bg-destructive-foreground/20 text-destructive-foreground">
                      {shortcutClearContext}
                    </Kbd>
                  )}
                </span>
                {yoloLabel && (
                  <span className="text-[10px] opacity-70">{yoloLabel}</span>
                )}
              </span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
