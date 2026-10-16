/**
 * Sidebar rows, as in a macOS source list: a neutral rounded selection pill,
 * no accent bar, and one indent step per tree level.
 *
 * Every level's leading glyph (folder chevron, project avatar, workspace
 * status dot, session dot) sits one step further right:
 *
 *   folder / project at depth d   16 + 16·d
 *   workspace                     32 + 16·d
 *   session group label (IDLE)    48 + 16·d
 *   session in a group            60 + 16·d
 *
 * Folders and projects reach depth d through the tree wrapper
 * (`SIDEBAR_INDENT_STEP_PX`, ProjectTree / FolderTreeItem). Workspaces and
 * sessions sit in lists with a guide line under the parent's glyph, so their
 * offsets below are measured from that line. Change one value, check them all.
 */

/** One tree level, in px. */
export const SIDEBAR_INDENT_STEP_PX = 16

/** Inset and rounding of a top-level row (Home, folder depth 0, project). The
 * width is explicit: a `<button>` row does not stretch to fill like a block. */
export const SIDEBAR_ROW_SHAPE = 'mx-2 w-[calc(100%-1rem)] rounded-md'

/** Inset and rounding of a row inside a guide-lined list. */
export const SIDEBAR_NESTED_ROW_SHAPE =
  'ml-1 mr-2 w-[calc(100%-0.75rem)] rounded-md'

/** Padding of a project row: pill inset (8) + 8 = glyph at 16. */
export const SIDEBAR_PROJECT_ROW_PADDING = 'pl-2 pr-1'

/** The workspace list of a project: guide line under the project avatar
 * (16 + 7), content from 23. */
export const SIDEBAR_WORKTREE_LIST = 'ml-[22px] border-l border-border/40'

/** A workspace row in that list: 23 + 4 (pill inset) + 5 = glyph at 32. */
export const SIDEBAR_WORKTREE_ROW_PADDING = 'pl-[5px] pr-1'

/** A workspace-level row without a pill (Pinned): 23 + 9 = glyph at 32. */
export const SIDEBAR_WORKTREE_SECTION_PADDING = 'pl-[9px]'

/** The session list of a workspace, relative to the workspace list content
 * (23): guide line under the workspace dot (32 + 4 = 36), content from 37. */
export const SIDEBAR_SESSION_LIST = 'ml-[13px] border-l border-border/40'

/** A session row in that list without a group label (Pinned, Starred):
 * 37 + 4 (pill inset) + 7 = glyph at 48. */
export const SIDEBAR_SESSION_ROW_PADDING = 'pl-[7px] pr-1'

/** A session group label (IDLE, WAITING): 37 + 11 = glyph at 48. */
export const SIDEBAR_SESSION_GROUP_PADDING = 'pl-[11px]'

/** A session row under a group label: 37 + 4 (pill inset) + 19 = glyph at 60,
 * one step in from the label, level with its text (48 + 6 dot + 6 gap). Do not
 * align it with the label: the group then reads as one more row (#39). */
export const SIDEBAR_GROUPED_SESSION_ROW_PADDING = 'pl-[19px] pr-1'

/** The selected row. */
export const SIDEBAR_ROW_SELECTED = 'bg-foreground/10 text-foreground'
