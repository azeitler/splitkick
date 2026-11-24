import { describe, expect, it } from 'vitest'
import type { Project } from '@/types/projects'
import { groupProjectsByFolder, ROOT_PROJECT_GROUP_ID } from './project-groups'

function item(
  id: string,
  order: number,
  extra: Partial<Project> = {}
): Project {
  return { id, name: id, order, ...extra } as unknown as Project
}
const folder = (id: string, order: number, parent_id?: string) =>
  item(id, order, { is_folder: true, ...(parent_id && { parent_id }) })

const summary = (projects: Project[]) =>
  groupProjectsByFolder(projects).map(group => ({
    id: group.id,
    path: group.path.join(' / '),
    projects: group.projects.map(p => p.id),
  }))

describe('groupProjectsByFolder', () => {
  it('groups by folder in tree order, loose projects last', () => {
    const projects = [
      item('loose-b', 3),
      item('acme', 1, { parent_id: 'clients' }),
      folder('internal', 1),
      item('loose-a', 2),
      item('docs', 0, { parent_id: 'clients' }),
      folder('clients', 0),
      item('tools', 0, { parent_id: 'internal' }),
    ]
    expect(summary(projects)).toEqual([
      { id: 'clients', path: 'clients', projects: ['docs', 'acme'] },
      { id: 'internal', path: 'internal', projects: ['tools'] },
      {
        id: ROOT_PROJECT_GROUP_ID,
        path: '',
        projects: ['loose-a', 'loose-b'],
      },
    ])
  })

  it('puts a nested folder after its parent, with the full path', () => {
    const projects = [
      folder('clients', 0),
      folder('archive', 0, 'clients'),
      item('old', 0, { parent_id: 'archive' }),
      item('acme', 1, { parent_id: 'clients' }),
    ]
    expect(summary(projects)).toEqual([
      { id: 'clients', path: 'clients', projects: ['acme'] },
      { id: 'archive', path: 'clients / archive', projects: ['old'] },
    ])
  })

  it('skips empty folders and gives no root group without loose projects', () => {
    const projects = [
      folder('empty', 0),
      folder('clients', 1),
      item('acme', 0, { parent_id: 'clients' }),
    ]
    expect(summary(projects).map(group => group.id)).toEqual(['clients'])
  })

  it('keeps a project whose folder is missing, in the root group', () => {
    const projects = [item('orphan', 0, { parent_id: 'gone' }), item('a', 1)]
    expect(summary(projects)).toEqual([
      { id: ROOT_PROJECT_GROUP_ID, path: '', projects: ['a', 'orphan'] },
    ])
  })

  it('returns one root group when there are no folders', () => {
    expect(summary([item('b', 1), item('a', 0)])).toEqual([
      { id: ROOT_PROJECT_GROUP_ID, path: '', projects: ['a', 'b'] },
    ])
  })
})
