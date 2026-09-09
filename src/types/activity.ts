/**
 * Activity feed records.
 *
 * Mirrors `ActivityEvent` in `jean-core/src/activity/mod.rs`. The Rust struct
 * uses `#[serde(rename_all = "camelCase")]`, so this interface is camelCase.
 */

/** What happened. Matches `ActivityKind` (serialised as snake_case). */
export type ActivityKind =
  | 'session_completed'
  | 'session_cancelled'
  | 'session_crashed'
  | 'commit_created'
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'review_finished'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  /** Unix timestamp in seconds. */
  at: number
  projectId?: string
  projectName?: string
  worktreeId?: string
  worktreeName?: string
  worktreePath?: string
  sessionId?: string
  sessionName?: string
  /** Short line shown in the feed, e.g. a commit subject. */
  title?: string
  /** Link to open, e.g. a pull request URL. */
  url?: string
  dedupeKey?: string
}
