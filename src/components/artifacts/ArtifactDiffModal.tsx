import { useEffect, useState, type ReactNode } from 'react'
import { GitCompare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { InlineFileDiff } from '@/components/chat/InlineFileDiff'
import { invoke } from '@/lib/transport'
import type { Artifact, ArtifactVersion } from '@/types/chat'
import {
  IMAGE_RE,
  comparableVersions,
  snapshotPath,
  targetName,
} from './artifact-versions'

interface ArtifactDiffModalProps {
  artifact: Artifact | null
  /** Folder of the session's artifact copies. */
  snapshotDir: string | null | undefined
  /** Version numbers to compare first; default: the last two. */
  initial?: { from: number; to: number }
  onClose: () => void
}

type Side =
  | { kind: 'text'; text: string }
  | { kind: 'image'; src: string }
  | { kind: 'binary' }
  | { kind: 'error'; message: string }

interface FileBase64Content {
  data: string
  mimeType: string
}

async function loadSide(path: string, image: boolean): Promise<Side> {
  try {
    if (image) {
      const file = await invoke<FileBase64Content>('read_file_base64', { path })
      return { kind: 'image', src: `data:${file.mimeType};base64,${file.data}` }
    }
    return {
      kind: 'text',
      text: await invoke<string>('read_file_content', { path }),
    }
  } catch (error) {
    const message = String(error)
    // read_file_content reads UTF-8 only: anything else is binary here.
    if (/utf-?8|invalid data|stream did not contain/i.test(message)) {
      return { kind: 'binary' }
    }
    return { kind: 'error', message }
  }
}

function formatSize(size: number | undefined): string {
  if (size === undefined) return 'unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function VersionPicker({
  label,
  versions,
  value,
  onChange,
}: {
  label: string
  versions: ArtifactVersion[]
  value: number
  onChange: (version: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      >
        {versions.map(v => (
          <option key={v.version} value={v.version}>
            v{v.version}
            {v.change ? ` · ${v.change}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Compare two versions of an artifact (#108): a line diff for text (HTML,
 * SVG and Markdown as source), two images side by side, or the sizes of a
 * binary file.
 */
export function ArtifactDiffModal({
  artifact,
  snapshotDir,
  initial,
  onClose,
}: ArtifactDiffModalProps) {
  const versions = artifact ? comparableVersions(artifact) : []
  const last = versions.at(-1)?.version ?? 0
  const [from, setFrom] = useState(
    initial?.from ?? versions.at(-2)?.version ?? last
  )
  const [to, setTo] = useState(initial?.to ?? last)
  const [sides, setSides] = useState<[Side, Side] | null>(null)

  const fromVersion = versions.find(v => v.version === from)
  const toVersion = versions.find(v => v.version === to)
  const name = artifact ? targetName(artifact) : ''
  const image = IMAGE_RE.test(name)

  useEffect(() => {
    setSides(null)
    if (!fromVersion || !toVersion) return
    const fromPath = snapshotPath(snapshotDir, fromVersion)
    const toPath = snapshotPath(snapshotDir, toVersion)
    if (!fromPath || !toPath) return
    let cancelled = false
    void Promise.all([loadSide(fromPath, image), loadSide(toPath, image)]).then(
      loaded => {
        if (!cancelled) setSides(loaded)
      }
    )
    return () => {
      cancelled = true
    }
  }, [fromVersion, toVersion, snapshotDir, image])

  let body: ReactNode = (
    <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
  )
  if (!fromVersion || !toVersion) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Pick two versions that have a copy.
      </p>
    )
  } else if (sides) {
    const [a, b] = sides
    if (a.kind === 'error' || b.kind === 'error') {
      body = (
        <p className="py-6 text-center text-sm text-destructive">
          Could not read a version:{' '}
          {a.kind === 'error' ? a.message : b.kind === 'error' ? b.message : ''}
        </p>
      )
    } else if (a.kind === 'image' && b.kind === 'image') {
      body = (
        <div
          className="grid grid-cols-2 gap-3"
          data-testid="artifact-image-diff"
        >
          {[
            { version: fromVersion, src: a.src },
            { version: toVersion, src: b.src },
          ].map(({ version, src }) => (
            <figure key={version.version} className="flex flex-col gap-1">
              <figcaption className="text-xs text-muted-foreground">
                v{version.version} · {formatSize(version.size)}
              </figcaption>
              <img
                src={src}
                alt={`Version ${version.version} of ${name}`}
                className="max-h-[60vh] w-full rounded-md border border-border bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
              />
            </figure>
          ))}
        </div>
      )
    } else if (a.kind === 'text' && b.kind === 'text') {
      body =
        a.text === b.text ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            The content of v{from} and v{to} is the same.
          </p>
        ) : (
          <InlineFileDiff
            filePath={name}
            oldString={a.text}
            newString={b.text}
            maxHeightClass="max-h-[65vh]"
          />
        )
    } else {
      body = (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Binary file, no line diff: v{from} {formatSize(fromVersion.size)} → v
          {to} {formatSize(toVersion.size)}
          {fromVersion.sha256 === toVersion.sha256 ? ' (same content)' : ''}.
        </p>
      )
    }
  }

  return (
    <Dialog open={!!artifact} onOpenChange={open => !open && onClose()}>
      <DialogContent className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-4 sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg">
        <DialogTitle className="flex items-center gap-2 pr-8">
          <GitCompare className="h-4 w-4 shrink-0" />
          <span className="truncate">{artifact?.title}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {name}
          </span>
        </DialogTitle>
        <DialogDescription className="sr-only">
          Compare two versions of {artifact?.title}.
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-3">
          <VersionPicker
            label="From"
            versions={versions}
            value={from}
            onChange={setFrom}
          />
          <VersionPicker
            label="To"
            versions={versions}
            value={to}
            onChange={setTo}
          />
        </div>
        <ScrollArea className="mt-2 min-h-0 flex-1 sm:max-h-[calc(85vh-8rem)]">
          {body}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
