// Types that match the Rust UIState struct
// Contains ephemeral UI state that should be restored on app restart
// Note: Field names use snake_case to match Rust struct exactly
//
// Session-specific state (answered_questions, submitted_answers, fixed_findings,
// pending_permission_denials, denied_message_context, reviewing_sessions) is now
// stored in the Session files. See useSessionStatePersistence.

import type { ReviewResponse } from './projects'

export interface UIState {
  active_worktree_id: string | null
  active_worktree_path: string | null
  active_project_id: string | null
  expanded_project_ids: string[]
  expanded_folder_ids: string[]
  /** Left sidebar width in pixels, defaults to 250 */
  left_sidebar_size?: number
  /** Left sidebar visibility, defaults to false */
  left_sidebar_visible?: boolean
  /** Active session ID per worktree (for restoring open tabs) */
  active_session_ids: Record<string, string>
  /** AI review results per worktree: worktreeId → ReviewResponse */
  review_results: Record<string, ReviewResponse>
  /** Whether viewing review tab per worktree: worktreeId → viewing */
  viewing_review_tab: Record<string, boolean>
  /** Fixed AI review findings per worktree: worktreeId → array of fixed findingKeys */
  fixed_review_findings: Record<string, string[]>
  /** Session IDs that completed while out of focus, need digest on open */
  pending_digest_session_ids: string[]
  /** Modal terminal drawer open state per worktree */
  modal_terminal_open?: Record<string, boolean>
  /** Modal terminal drawer width in pixels */
  modal_terminal_width?: number
  /** Last-accessed timestamps per project for recency sorting: projectId → unix ms */
  project_access_timestamps?: Record<string, number>
  version: number
}

export const defaultUIState: UIState = {
  active_worktree_id: null,
  active_worktree_path: null,
  active_project_id: null,
  expanded_project_ids: [],
  expanded_folder_ids: [],
  left_sidebar_size: 250,
  left_sidebar_visible: false,
  active_session_ids: {},
  review_results: {},
  viewing_review_tab: {},
  fixed_review_findings: {},
  pending_digest_session_ids: [],
  modal_terminal_open: {},
  modal_terminal_width: 400,
  version: 1,
}
