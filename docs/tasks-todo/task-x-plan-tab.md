# Plan: Add "Plan" Tab Next to Sessions

## Overview

Add a persistent "Plan" tab (like the existing Review tab) that displays the latest plan sent by Claude Code via `ExitPlanMode`. The tab appears next to session tabs and shows the plan content with approval controls.

## Architecture Decision

- **Worktree-scoped** (like Review tab) - plans are relevant to the entire worktree
- **Shows only the latest plan** - new plan replaces previous
- **Persists until explicitly closed** - user dismisses with close button

## Implementation Steps

### 1. Add Types (src/types/chat.ts)

Add plan content interface:

```typescript
export interface PlanContent {
  content: string // markdown content (inline or fetched from file)
  filePath?: string // optional file path if from ~/.claude/plans/
  toolCallId: string // for tracking approval status
  messageId?: string // source message ID for persisted plans
  timestamp: number // when plan was received
  approved?: boolean // true after user approves (tab stays open)
}
```

### 2. Add Store State (src/store/chat-store.ts)

Add to `ChatUIState` interface:

```typescript
// Plan content per worktree (latest plan only)
planContent: Record<string, PlanContent>
// Track if viewing plan tab per worktree
viewingPlanTab: Record<string, boolean>
```

Add actions:

- `setPlanContent(worktreeId, content)` - stores plan and auto-switches to tab
- `clearPlanContent(worktreeId)` - removes plan and tab
- `setViewingPlanTab(worktreeId, viewing)` - toggle view
- `markPlanApproved(worktreeId)` - marks plan as approved (tab stays open)

### 3. Detect Plans in useStreamingEvents.ts

In `chat:done` event handler, after checking for blocking tools:

```typescript
// Detect ExitPlanMode and store plan content
const exitPlanTool = toolCalls?.find(isExitPlanMode)
if (exitPlanTool) {
  const toolInput = exitPlanTool.input as { plan?: string } | undefined
  const inlinePlan = toolInput?.plan
  const filePath = findPlanFilePath(toolCalls ?? [])

  if (inlinePlan || filePath) {
    setPlanContent(worktreeId, {
      content: inlinePlan ?? '', // Will fetch from file if empty
      filePath: filePath ?? undefined,
      toolCallId: exitPlanTool.id,
      timestamp: Date.now(),
    })
  }
}
```

### 4. Create PlanResultsPanel.tsx

New component similar to ReviewResultsPanel:

- Subscribe to `planContent[worktreeId]`
- Display plan using existing `PlanDisplay` component
- Include "Approve" button (reuse handlePlanApproval logic via custom event)
- Include "Approve (yolo)" button
- Close button clears plan

### 5. Update SessionTabBar.tsx

Add Plan tab next to Review tab (before sessions):

```typescript
{planContent && (
  <div onClick={handlePlanTabClick} className={...}>
    <FileText className="..." />
    <span>Plan</span>
    <button onClick={handleClosePlanTab}><X /></button>
  </div>
)}
```

Wire handlers:

- `handlePlanTabClick` → `setViewingPlanTab(worktreeId, true)`
- `handleClosePlanTab` → `clearPlanContent(worktreeId)`

### 6. Update ChatWindow.tsx

Add selector and conditional render:

```typescript
const isViewingPlanTab = useChatStore(state =>
  state.activeWorktreeId
    ? (state.viewingPlanTab[state.activeWorktreeId] ?? false)
    : false
)

// In render:
{isViewingPlanTab ? (
  <PlanResultsPanel worktreeId={activeWorktreeId} />
) : isViewingReviewTab ? (
  <ReviewResultsPanel worktreeId={activeWorktreeId} />
) : (
  // Normal chat view
)}
```

Add event listener for plan approval from panel:

```typescript
useEffect(() => {
  const handlePlanApproveFromTab = (e: CustomEvent) => {
    const { messageId, yolo } = e.detail
    if (yolo) {
      handlePlanApprovalYolo(messageId)
    } else {
      handlePlanApproval(messageId)
    }
    // Mark plan as approved (tab stays open for reference)
    markPlanApproved(worktreeId)
  }
  window.addEventListener('plan-approve-from-tab', handlePlanApproveFromTab)
  return () => window.removeEventListener(...)
}, [...])
```

## Files to Modify

1. `src/types/chat.ts` - Add PlanContent interface
2. `src/store/chat-store.ts` - Add state and actions
3. `src/components/chat/hooks/useStreamingEvents.ts` - Detect plans on done
4. `src/components/chat/PlanResultsPanel.tsx` - **NEW FILE**
5. `src/components/chat/SessionTabBar.tsx` - Add Plan tab
6. `src/components/chat/ChatWindow.tsx` - Conditional render + event listener

## Behavior Notes

- Plan tab appears when ExitPlanMode tool completes
- Clicking Plan tab shows the panel (replaces chat view)
- Approving from Plan tab: sends "Approved", switches mode, **tab stays open** for reference
- After approval: plan shows as "approved" state, user can close manually
- Closing tab: plan content is cleared (can still approve inline if message exists)
- New plan replaces old plan silently (only latest shown)
- Plan tab is worktree-scoped (same plan across all sessions in worktree)

## Verification

1. Start a session in plan mode, send a task
2. When Claude sends ExitPlanMode → Plan tab should appear
3. Click Plan tab → Panel shows with plan content and approve buttons
4. Click Approve → Message sent, mode changes to build, tab stays open with "approved" state
5. Test close button → Tab dismissed, plan still approvable inline
