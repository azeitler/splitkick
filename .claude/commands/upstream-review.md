---
allowed-tools: [Read, Write, Bash, Grep, Glob]
description: 'Review what upstream (coollabsio/jean) changed since the fork last took it'
---

# /upstream-review - Review upstream changes

## Purpose

Find out what `coollabsio/jean` changed since Splitkick last took it, what each
change would mean for Splitkick, and how risky taking it would be. You do the
review yourself with git. This command only reads the repository and writes one
report. It never merges, rebases, cherry-picks, pushes or edits code.

## Steps

1. **Fetch:** `git fetch upstream` (remote `upstream` =
   `https://github.com/coollabsio/jean.git`; add it if it is missing).
2. **Baseline:** read `sha` from `docs/upstream/last-sync.json`. Never use
   `git merge-base main upstream/main`: the upstream 1.0.1 merge was reverted,
   git still counts its commits as merged, and the merge base hides them. See
   `docs/developer/upstream-sync.md`.
3. **List:** `git log --oneline --no-merges <sha>..upstream/main`. Note the
   upstream versions crossed (`git tag --contains`, or the version bump
   commits) and the counts by type (feat, fix, …).
4. **Overlap:** for the files upstream changed
   (`git diff --stat <sha> upstream/main`), check which the fork also changed
   (`git log --oneline <sha>..main -- <file>`). Files both sides changed often
   are the likely merge conflicts.
5. **Read before you judge.** For every commit that touches one of these areas,
   read the upstream diff (`git show <commit>`) and the fork's side of the same
   files. Never judge from commit subjects alone.
   - transport and routing between local and remote backends
     (`src/lib/transport*`, `jean-core/src/http_server/`, remote connections)
   - session identity and storage (session ids, run logs, `chat/storage`)
   - persisted UI state (`ui-state`, `useUIStatePersistence`)
   - release, updater and fork identity (version, bundle id, product name,
     updater feeds, CI workflows)

   Apply `.ai/lessons.md`, "Do not release a large upstream merge on green tests
   alone": the reverted 1.0.1 merge passed every test and still broke remote
   sessions. A change in these areas needs a branch and a run of the real
   desktop app with a remote server, not only a green `check:all`.

6. **Write the report** to
   `docs/upstream/reviews/<YYYY-MM-DD>-<baseline7>-<upstreamhead7>.md`:
   - **At a glance:** commit count, counts by type, upstream versions crossed.
   - **Worth taking:** upstream features and fixes Splitkick users would notice,
     grouped by area, one line each, with the upstream commit or PR link.
   - **Already in the fork:** upstream changes the fork has its own version
     of. Name the fork commit; say whether the two conflict or one replaces
     the other.
   - **Risky:** the commits from step 5 that matter, and why.
   - **Conflicts:** where a merge will conflict, and which side should win.
   - **Recommendation:** merge all, merge up to an upstream version,
     cherry-pick a list, or wait — with the reason and a test plan.
7. Run `bunx prettier --write` on the report, then give the file path and the
   recommendation in chat.

## After a merge

Move `sha` and `date` in `docs/upstream/last-sync.json` to the upstream commit
that was merged only after the merge is **kept** on `main` and has shipped —
never on a branch. Ask before you change it.
