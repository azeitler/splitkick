import Fuse from 'fuse.js'
import type { WorktreeFile } from '@/types/chat'

/**
 * Fuzzy search over worktree files by relative path.
 * Weights filename matches higher than directory path matches.
 */
export function fuzzySearchFiles(
  files: WorktreeFile[],
  query: string,
  limit = 15
): WorktreeFile[] {
  return fuzzySearchFilesScored(files, query, limit).map(r => r.item)
}

/**
 * {@link fuzzySearchFiles} with the Fuse score of each hit (0 = exact,
 * 1 = no match). The mention picker compares it with the other groups.
 */
export function fuzzySearchFilesScored(
  files: WorktreeFile[],
  query: string,
  limit = 15
): { item: WorktreeFile; score: number }[] {
  if (!query) return files.slice(0, limit).map(item => ({ item, score: 0 }))

  const fuse = new Fuse(files, {
    keys: ['relative_path'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    // Score filename portion higher by using a custom getFn
    // that also indexes the basename separately
  })

  return fuse
    .search(query, { limit })
    .map(r => ({ item: r.item, score: r.score ?? 0 }))
}

/**
 * Fuzzy search over slash commands and skills by name and description.
 */
export function fuzzySearchItems<
  T extends { name: string; description?: string | null },
>(items: T[], query: string, limit = 15): T[] {
  if (!query) return items.slice(0, limit)

  const fuse = new Fuse(items, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'description', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  })

  return fuse.search(query, { limit }).map(r => r.item)
}
