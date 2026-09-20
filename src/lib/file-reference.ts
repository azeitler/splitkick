/**
 * Resolving a file reference written in chat to a real path on disk.
 *
 * A path in a chat answer, or an `@`-mention, is a bare string. `docs/api.md`
 * may be relative to the worktree, to a package inside it, to a linked
 * project, or to wherever a tool happened to run. Joining it onto the worktree
 * root and hoping is what this module replaces.
 *
 * Instead the session's own evidence orders a list of candidates, and the
 * backend reports which of them exist:
 *
 * 1. An absolute reference is itself, and only needs confirming.
 * 2. Absolute paths the session's tool calls touched, newest first. A Read or
 *    an Edit records where the agent really was, which no string can tell you.
 * 3. The roots: the worktree, and any root the caller adds (a linked project).
 * 4. Failing all of those, the backend searches the worktree for a path that
 *    ends with the reference.
 *
 * Nothing is guessed: a reference that resolves to nothing is reported as
 * missing, so the UI can decline to draw a link that only opens an error.
 */

import { useContext, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LocalPathRootContext, toLocalReferencePath } from '@/lib/chat-links'
import {
  isAbsolutePath,
  joinPaths,
  normalizePath,
  splitFileRefSuffix,
} from '@/lib/path-utils'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import type { ChatMessage } from '@/types/chat'

/** Reply from the `resolve_file_reference` command. */
export interface ResolvedFileReference {
  /** Best match, or null when nothing exists. */
  path: string | null
  /** Every match that exists, best first. */
  candidates: string[]
  /** True when the backend searched the worktree. */
  searched: boolean
}

/**
 * The thread rendered for each worktree root, so a link inside it can look up
 * what the session has touched.
 *
 * A module-level registry rather than a React context, for one blunt reason:
 * a context needs a provider element around the thread, and wrapping
 * `ChatWindow`'s tree re-indents 2,400 lines of it for no gain. The key is the
 * worktree, so the main window and the canvas modal cannot overwrite each
 * other, and two views of the same worktree agree by definition.
 */
const threadMessagesByRoot = new Map<string, ChatMessage[]>()

/**
 * Absolute paths the thread rooted at `root` is known to have touched.
 *
 * The walk happens here, on lookup, not when the thread publishes: a
 * streaming answer republishes on every chunk, and walking every tool call
 * each time would cost far more than the few resolutions it feeds.
 */
export function knownPathsFor(root: string | null | undefined): string[] {
  if (!root) return []
  const messages = threadMessagesByRoot.get(root)
  return messages ? collectToolCallPaths(messages) : []
}

/**
 * Publish a thread's messages for the links inside it, and re-check every
 * reference when a turn ends.
 *
 * Call it once per rendered thread — `ChatWindow` does.
 */
export function useFileReferenceEvidence(options: {
  worktreePath: string | null | undefined
  messages: ChatMessage[]
  /** True while a turn is running. */
  isSending?: boolean
}): void {
  const { worktreePath, messages, isSending } = options
  const queryClient = useQueryClient()

  // Published during render, not in an effect. React runs a child's effects
  // before its parent's, so a link below would resolve itself before an
  // effect here could tell it anything — and every link would miss the
  // evidence on the first render, the one that matters.
  useMemo(() => {
    if (worktreePath) threadMessagesByRoot.set(worktreePath, messages)
  }, [worktreePath, messages])

  useEffect(() => {
    if (!worktreePath) return
    return () => {
      threadMessagesByRoot.delete(worktreePath)
    }
  }, [worktreePath])

  // An answer can name a file before the agent writes it, and that reference
  // resolves to nothing. Re-check them all once the turn is over, so the link
  // appears without the user reloading anything.
  const wasSending = useRef(isSending)
  useEffect(() => {
    if (wasSending.current && !isSending) {
      void queryClient.invalidateQueries({ queryKey: ['file-reference'] })
    }
    wasSending.current = isSending
  }, [isSending, queryClient])
}

/**
 * Tool input fields that name a file. Claude uses `file_path`, Codex and
 * Cursor use `path`, notebook edits use `notebook_path`.
 */
const PATH_INPUT_KEYS = [
  'file_path',
  'filePath',
  'notebook_path',
  'notebookPath',
  'path',
  'target_file',
] as const

/** Upper bound on remembered paths, so a long session stays cheap to search. */
const MAX_KNOWN_PATHS = 400

/**
 * Absolute paths the session's tool calls touched, newest first.
 *
 * This is the evidence a reference cannot carry: when an agent writes
 * `packages/web/docs/api.md` and then calls it `docs/api.md` in its answer,
 * the tool call is the only record of which one it meant.
 */
export function collectToolCallPaths(messages: ChatMessage[]): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = messages[i]?.tool_calls
    if (!calls?.length) continue
    for (let j = calls.length - 1; j >= 0; j--) {
      const input = calls[j]?.input
      if (!input || typeof input !== 'object') continue
      const record = input as Record<string, unknown>
      for (const key of PATH_INPUT_KEYS) {
        const value = record[key]
        if (typeof value !== 'string' || !isAbsolutePath(value)) continue
        if (seen.has(value)) continue
        seen.add(value)
        paths.push(value)
        if (paths.length >= MAX_KNOWN_PATHS) return paths
      }
    }
  }

  return paths
}

/** Whether `path` ends with `reference` at a separator boundary. */
function pathTailMatches(path: string, reference: string): boolean {
  if (path === reference) return true
  return (
    path.endsWith(reference) && path[path.length - reference.length - 1] === '/'
  )
}

/**
 * Every place the reference might be, best first.
 *
 * The order is the whole point: the backend takes the first candidate that
 * exists, so a path the session really touched must come before a hopeful
 * join onto the worktree root.
 */
export function buildFileReferenceCandidates(
  reference: string,
  evidence: { roots: string[]; knownPaths: string[] }
): string[] {
  const raw = toLocalReferencePath(splitFileRefSuffix(reference)[0])
  if (!raw) return []

  if (isAbsolutePath(raw)) return [raw]

  const relative = normalizePath(raw).replace(/^\.\//, '')
  if (!relative) return []

  const out: string[] = []
  const push = (path: string) => {
    if (path && !out.includes(path)) out.push(path)
  }

  for (const known of evidence.knownPaths) {
    if (pathTailMatches(normalizePath(known), relative)) push(known)
  }
  for (const root of evidence.roots) {
    if (root) push(joinPaths(root, relative))
  }

  return out
}

export type FileReferenceStatus =
  | 'disabled'
  | 'resolving'
  | 'found'
  | 'ambiguous'
  | 'missing'

export interface FileReferenceResult {
  status: FileReferenceStatus
  /** Best existing path, or null while resolving and when missing. */
  path: string | null
  /** Every existing path, best first. More than one means `ambiguous`. */
  candidates: string[]
  /** The primary root, for showing a candidate as a relative path. */
  root: string | null
}

const EMPTY = { path: null, candidates: [] as string[], root: null }

/**
 * Resolve one reference against the surrounding session.
 *
 * Returns `disabled` when there is nothing to resolve (a web link, an anchor),
 * so a caller can use the same hook for every link and branch on the result.
 */
export function useFileReference(
  reference: string | undefined,
  options?: { extraRoots?: string[]; enabled?: boolean }
): FileReferenceResult {
  const contextRoot = useContext(LocalPathRootContext)
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const extraRoots = options?.extraRoots

  const roots = useMemo(() => {
    const all = [
      ...(extraRoots ?? []),
      contextRoot ?? '',
      activeWorktreePath ?? '',
    ]
    return all.filter((root, index) => root && all.indexOf(root) === index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraRoots?.join('|'), contextRoot, activeWorktreePath])

  const enabled = (options?.enabled ?? true) && !!reference

  const query = useQuery({
    queryKey: ['file-reference', reference ?? '', roots.join('|')],
    enabled,
    // Long enough that scrolling a virtualized thread does not re-ask for
    // every link it remounts. Freshness comes from the turn's end, which
    // invalidates this key (see `useFileReferenceEvidence`).
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<ResolvedFileReference | null> => {
      const candidates = buildFileReferenceCandidates(reference ?? '', {
        roots,
        knownPaths: knownPathsFor(roots[0]),
      })
      // No root and no tool call name a place to look. Report nothing rather
      // than "missing": the reference may be perfectly good, and the caller
      // falls back to the plain join it used before.
      if (candidates.length === 0) return null
      const reply = await invoke<ResolvedFileReference | null>(
        'resolve_file_reference',
        {
          reference: toLocalReferencePath(
            splitFileRefSuffix(reference ?? '')[0]
          ),
          candidates,
          searchRoot: roots[0] ?? null,
        }
      )
      return reply ?? null
    },
  })

  const root = roots[0] ?? null
  if (!enabled) return { ...EMPTY, status: 'disabled' }
  if (!query.data) {
    // Not resolved, or the resolution failed. Either way the caller keeps its
    // old behaviour: claiming the file is gone on no evidence would hide a
    // link that works.
    return { ...EMPTY, status: query.isError ? 'disabled' : 'resolving', root }
  }
  const { path, candidates } = query.data
  if (!path) return { ...EMPTY, status: 'missing', root }
  return {
    status: candidates.length > 1 ? 'ambiguous' : 'found',
    path,
    candidates,
    root,
  }
}
