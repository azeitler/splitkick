/** Separator between title segments (U+203A). */
const SEPARATOR = ' › '

export interface WindowTitleParts {
  /** Fallback title when no worktree is selected. */
  productName: string
  projectName?: string | null
  worktreeName?: string | null
  branch?: string | null
  /** Mobile shows only the project name, to fit the compact title bar. */
  isMobile: boolean
  /** Active remote connection name; null or undefined while the backend is local. */
  remoteName?: string | null
}

/**
 * Build the title bar breadcrumb: `Instance › Project › Worktree (branch)`.
 *
 * A remote backend puts its connection name in front, so you always see which
 * machine you drive. Zen mode keeps the full breadcrumb on the desktop.
 */
export function formatWindowTitle({
  productName,
  projectName,
  worktreeName,
  branch,
  isMobile,
  remoteName,
}: WindowTitleParts): string {
  const base = (() => {
    if (!projectName || !worktreeName) return productName
    if (isMobile) return projectName
    const branchSuffix = branch && branch !== worktreeName ? ` (${branch})` : ''

    return `${projectName}${SEPARATOR}${worktreeName}${branchSuffix}`
  })()

  if (!remoteName) return base
  // Nothing selected: the instance name alone beats "server › Jean".
  return base === productName ? remoteName : `${remoteName}${SEPARATOR}${base}`
}
