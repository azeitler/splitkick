#!/usr/bin/env bash
# After a release: bring the website and the docs up to date and push them, so Vercel deploys both.
#   website (Digitalheld/splitkick-website): download card = newest release (scripts/sync-release.mjs)
#   docs    (azeitler/splitkick-docs):       release notes from this repo's CHANGELOG.md (scripts/sync-changelog.mjs)
# Each repo has a deploy key with write access; its private key is a secret here
# (SPLITKICK_WEBSITE_DEPLOY_KEY, SPLITKICK_DOCS_DEPLOY_KEY). A repo whose key is missing is skipped.
# Usage (CI, after "Publish the release"): bash scripts/sync-sites.sh <version>
# Test: SYNC_REMOTE_BASE=file:///path/to/bare/ points the clones at local bare repos instead of GitHub.
set -euo pipefail

VERSION="${1:?usage: sync-sites.sh <version>}"
CHANGELOG="$(pwd)/CHANGELOG.md"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sync() {
  local name="$1" repo="$2" key="$3" cmd="$4" paths="$5"
  if [ -z "$key" ]; then
    echo "::warning::$name: no deploy key secret - skipped"
    return 0
  fi
  local keyfile="$WORK/$name.key"
  printf '%s\n' "$key" > "$keyfile"
  chmod 600 "$keyfile"
  export GIT_SSH_COMMAND="ssh -i $keyfile -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

  git clone --quiet --depth 1 "${SYNC_REMOTE_BASE:-git@github.com:}$repo.git" "$WORK/$name"
  (
    cd "$WORK/$name"
    eval "$cmd"
    # shellcheck disable=SC2086 # paths is a list of pathspecs
    if git diff --quiet -- $paths && [ -z "$(git ls-files --others --exclude-standard -- $paths)" ]; then
      echo "$name: already up to date for $VERSION"
      exit 0
    fi
    # shellcheck disable=SC2086
    git add -- $paths
    # Vercel deploys a commit only when its author is a member of the Vercel team, so the
    # author is Andreas (his GitHub-linked address); the committer marks it as automated.
    git -c user.name="Splitkick release" -c user.email="release@splitkick.app" \
      commit --quiet --author="${SYNC_AUTHOR:-Andreas Zeitler <andreas@planetfall.co>}" -m "chore: Splitkick $VERSION"
    git push --quiet origin HEAD:main
    echo "$name: pushed $(git rev-parse --short HEAD)"
  )
}

sync website Digitalheld/splitkick-website "${WEBSITE_DEPLOY_KEY:-}" "node scripts/sync-release.mjs" "src/site.ts CHANGELOG.md"
sync docs azeitler/splitkick-docs "${DOCS_DEPLOY_KEY:-}" "node scripts/sync-changelog.mjs '$CHANGELOG'" "docs/changelog"
