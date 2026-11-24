import { getSortedSiblings } from '@/components/projects/project-tree-drop'
import { isFolder, type Project } from '@/types/projects'

/** The id of the group that holds the projects in no folder. */
export const ROOT_PROJECT_GROUP_ID = 'root'

/** The projects of one sidebar folder, or of none (`folder` is null). */
export interface ProjectGroup {
  id: string
  folder: Project | null
  /** Folder names from the root down, e.g. `['Clients', 'Archive']`. */
  path: string[]
  projects: Project[]
}

/**
 * The projects of the Projects tree, grouped by folder in tree order.
 *
 * Each folder that holds projects directly becomes one group, ahead of the
 * groups of its sub-folders; a nested folder keeps its full path as the label.
 * The projects in no folder come last, where the tree lists them (it puts
 * folders first). Empty folders give no group. A project whose folder is not in
 * the list (filtered out, or a stale `parent_id`) falls back to the root group,
 * so no project goes missing.
 */
export function groupProjectsByFolder(items: Project[]): ProjectGroup[] {
  const groups: ProjectGroup[] = []
  const placed = new Set<string>()
  const seenFolders = new Set<string>()

  const visit = (folder: Project, path: string[]) => {
    // Guards against a parent_id cycle in a damaged file.
    if (seenFolders.has(folder.id)) return
    seenFolders.add(folder.id)
    const children = getSortedSiblings(items, folder.id)
    const projects = children.filter(p => !isFolder(p))
    if (projects.length > 0) {
      projects.forEach(p => placed.add(p.id))
      groups.push({ id: folder.id, folder, path, projects })
    }
    for (const child of children) {
      if (isFolder(child)) visit(child, [...path, child.name])
    }
  }

  const root = getSortedSiblings(items, undefined)
  for (const item of root) {
    if (isFolder(item)) visit(item, [item.name])
  }

  const loose = root.filter(p => !isFolder(p))
  loose.forEach(p => placed.add(p.id))
  loose.push(...items.filter(p => !isFolder(p) && !placed.has(p.id)))
  if (loose.length > 0) {
    groups.push({
      id: ROOT_PROJECT_GROUP_ID,
      folder: null,
      path: [],
      projects: loose,
    })
  }
  return groups
}
