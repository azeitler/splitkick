/**
 * Hardcoded release-notes instruction used by the "Update PR description" flow.
 *
 * Instead of a one-shot AI call, the Update-PR modal spawns a yolo chat session
 * seeded with this prompt plus the target PR number. The agent gathers the PR's
 * commits + closing-keyword issue references, writes user-facing grouped notes,
 * and updates the PR description in place via `gh pr edit`.
 *
 * This mirrors the `/release` slash command but is owned by Jean (no dependency
 * on any external skill file).
 */
const RELEASE_NOTES_INSTRUCTION = `You are updating the description of an existing GitHub pull request with user-facing release notes.

## Steps
1. Run \`git fetch origin\` so PR metadata and commits are up to date.
2. Inspect the target PR using the GitHub CLI:
   - \`gh pr view <PR_NUMBER> --json number,title,body,baseRefName,headRefName,commits\`
   - \`gh pr diff <PR_NUMBER>\` for additional context when needed.
3. For each commit in the PR, look for issue references using GitHub's official closing keywords (case-insensitive) in BOTH commit messages AND the PR body:
   - close / closes / closed
   - fix / fixes / fixed
   - resolve / resolves / resolved
   Collect every unique issue number that is closed/fixed/resolved.

## Writing the notes
Generate a concise, non-technical, user-facing description:
- Start the body with a \`## What's Changed\` heading.
- Group items under these sections, including ONLY the ones that have entries:
  \`### New Features\`, \`### Fixes\`, \`### Improvements\`, \`### Breaking Changes\`.
- Use simple, user-friendly language (no internal jargon). One short line per item.
- Skip internal refactoring, dependency bumps, and minor tweaks unless significant.
- The whole thing should be scannable in ~15 seconds.
- Do NOT reference the target PR (#<PR_NUMBER>) itself — these notes ARE that PR's
  description, so a self-link on every line is noise. Never write \`(#<PR_NUMBER>)\`.
- Only add references for OTHER, distinct PRs (not the target) and for issues the
  commits close/fix/resolve, inline using the detected keyword lowercased:
  \`(fixes #456, #789)\` / \`(closes #100)\` / \`(#321)\` for an unrelated PR.
- Most lines will have NO reference at all — that is expected and correct.
- Do NOT invent PR or issue numbers — only use references you actually detected.

## Applying the update
Update the PR description in place:
\`gh pr edit <PR_NUMBER> --body "<generated_markdown>"\`
After updating, fetch the PR's full URL with \`gh pr view <PR_NUMBER> --json url -q .url\`.
Then confirm to the user that PR #<PR_NUMBER> was updated, show the full clickable PR URL on its own line, and show the final notes.`

/**
 * Build the full session prompt for updating a specific PR's description.
 */
export function buildReleaseNotesSessionPrompt(prNumber: number): string {
  return `${RELEASE_NOTES_INSTRUCTION}

## Target
PR_NUMBER = ${prNumber}

Update PR #${prNumber} now.`
}
