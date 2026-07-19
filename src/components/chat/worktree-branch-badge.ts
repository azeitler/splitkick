export function getStackedBaseBranch(
  baseBranch: string | undefined,
  worktreeBranch: string | undefined,
  defaultBranch: string | undefined
): string | null {
  if (
    !baseBranch ||
    baseBranch === defaultBranch ||
    baseBranch === worktreeBranch
  ) {
    return null
  }

  return baseBranch
}
