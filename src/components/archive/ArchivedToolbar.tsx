import { Link2, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getBackendLabel } from '@/components/ui/backend-label'
import { cn } from '@/lib/utils'
import type { Backend } from '@/types/chat'
import type {
  ArchivedFilters,
  ArchivedKindFilter,
  ArchivedSort,
} from './archived-items'

const KIND_OPTIONS: { value: ArchivedKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'session', label: 'Sessions' },
  { value: 'worktree', label: 'Worktrees' },
]

const SORT_LABELS: Record<ArchivedSort, string> = {
  archived: 'Last archived',
  name: 'Name',
  project: 'Project',
}

interface ArchivedToolbarProps {
  filters: ArchivedFilters
  onFiltersChange: (filters: ArchivedFilters) => void
  sort: ArchivedSort
  onSortChange: (sort: ArchivedSort) => void
  counts: Record<ArchivedKindFilter, number>
  projects: { id: string; name: string }[]
  backends: Backend[]
}

/** Search, filters and sort above the Archived list. */
export function ArchivedToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  counts,
  projects,
  backends,
}: ArchivedToolbarProps) {
  const set = (patch: Partial<ArchivedFilters>) =>
    onFiltersChange({ ...filters, ...patch })

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search names, branches and messages…"
          value={filters.query}
          onChange={e => set({ query: e.target.value })}
          className="pl-8"
          aria-label="Search archived items"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Show"
          className="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {KIND_OPTIONS.map(option => (
            <Button
              key={option.value}
              role="radio"
              aria-checked={filters.kind === option.value}
              variant={filters.kind === option.value ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2.5"
              onClick={() => set({ kind: option.value })}
            >
              {option.label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {counts[option.value]}
              </span>
            </Button>
          ))}
        </div>
        <NativeSelect
          aria-label="Project"
          value={filters.projectId}
          onChange={e => set({ projectId: e.target.value })}
          className="h-8 max-w-48 text-xs"
        >
          <NativeSelectOption value="">All projects</NativeSelectOption>
          {projects.map(project => (
            <NativeSelectOption key={project.id} value={project.id}>
              {project.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {backends.length > 1 && (
          <NativeSelect
            aria-label="Backend"
            value={filters.backend}
            onChange={e => set({ backend: e.target.value })}
            className="h-8 text-xs"
          >
            <NativeSelectOption value="">All backends</NativeSelectOption>
            {backends.map(backend => (
              <NativeSelectOption key={backend} value={backend}>
                {getBackendLabel(backend)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort
          <NativeSelect
            aria-label="Sort"
            value={sort}
            onChange={e => onSortChange(e.target.value as ArchivedSort)}
            className="h-8 text-xs text-foreground"
          >
            {(Object.keys(SORT_LABELS) as ArchivedSort[]).map(value => (
              <NativeSelectOption key={value} value={value}>
                {SORT_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
    </div>
  )
}

interface ArchivedSelectionBarProps {
  visibleCount: number
  selectedCount: number
  busy: boolean
  onSelectAll: (select: boolean) => void
  onRestore: () => void
  onCopyLinks: () => void
  onDelete: () => void
}

/** "Select all" and the actions for the selected rows. */
export function ArchivedSelectionBar({
  visibleCount,
  selectedCount,
  busy,
  onSelectAll,
  onRestore,
  onCopyLinks,
  onDelete,
}: ArchivedSelectionBarProps) {
  const all = visibleCount > 0 && selectedCount === visibleCount
  return (
    <div
      className={cn(
        'flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 text-sm',
        selectedCount > 0 && 'bg-muted'
      )}
      data-testid="archived-selection-bar"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={all ? true : selectedCount > 0 ? 'indeterminate' : false}
          onCheckedChange={() => onSelectAll(!all)}
          disabled={visibleCount === 0}
          aria-label="Select all"
        />
        {selectedCount > 0
          ? `${selectedCount} selected`
          : `${visibleCount} item${visibleCount === 1 ? '' : 's'}`}
      </label>
      {selectedCount > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
            <RotateCcw className="h-4 w-4" />
            Restore
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopyLinks}>
            <Link2 className="h-4 w-4" />
            Copy links
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete…
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onSelectAll(false)}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
