# Reviewing upstream changes

Splitkick is a fork of [coollabsio/jean](https://github.com/coollabsio/jean),
fetched as the `upstream` remote. Before taking anything from upstream, run
`/upstream-review` in Claude Code (`.claude/commands/upstream-review.md`). An
agent reviews the upstream commits with git, reads the risky diffs on both
sides, and writes a report to `docs/upstream/reviews/`: what is worth taking,
what the fork already has, what is risky, where a merge conflicts, and a
recommendation with a test plan. It never merges or pushes.

## The baseline is a file, not the merge base

`docs/upstream/last-sync.json` names the upstream commit the fork really
contains. `git merge-base main upstream/main` cannot be trusted: the upstream
1.0.1 merge (`1cf20d58`) was reverted in `54d762af`, but git still counts its
commits as merged. The merge base therefore returns `4dbc022e` and hides 173
upstream commits the fork does not have.

Move `sha` and `date` in that file only after an upstream merge is **kept** on
`main` — not on a branch, and not before it has shipped.
