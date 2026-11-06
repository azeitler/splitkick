import { createProject, createSession, createWorktree } from './mock-data'

/**
 * Demo archive for the Archived page (#96): three made-up projects, archived
 * worktrees and sessions spread over the last three months.
 */

const HOUR = 60 * 60
const DAY = 24 * HOUR

export function archivedDemoData(nowSeconds = Math.floor(Date.now() / 1000)) {
  const web = createProject({ name: 'acme-web', order: 0 })
  const api = createProject({ name: 'billing-api', order: 1 })
  const docs = createProject({ name: 'docs-site', order: 2 })
  const projects = [web, api, docs]

  const webMain = createWorktree(web.id, {
    name: 'main',
    branch: 'main',
    session_type: 'base',
  })
  const apiMain = createWorktree(api.id, {
    name: 'main',
    branch: 'main',
    session_type: 'base',
  })

  const archivedWorktrees = [
    createWorktree(web.id, {
      name: 'checkout-redesign',
      branch: 'feat/checkout-redesign',
      archived_at: nowSeconds - 3 * HOUR,
      auto_archived_pr_url: 'https://github.com/acme/web/pull/412',
    }),
    createWorktree(api.id, {
      name: 'invoice-pdf',
      branch: 'fix/invoice-pdf',
      archived_at: nowSeconds - 1 * DAY - 2 * HOUR,
    }),
    createWorktree(docs.id, {
      name: 'search-index',
      branch: 'feat/search-index',
      archived_at: nowSeconds - 4 * DAY,
      auto_archived_pr_url: 'https://github.com/acme/docs/pull/88',
    }),
    createWorktree(web.id, {
      name: 'dark-mode-spike',
      branch: 'spike/dark-mode',
      archived_at: nowSeconds - 18 * DAY,
    }),
    createWorktree(docs.id, {
      name: 'old-theme',
      branch: 'chore/old-theme',
      archived_at: nowSeconds - 75 * DAY,
      auto_archived: true,
    }),
  ]

  const sessionSeeds: [
    string,
    string,
    number,
    string,
    string,
    number,
    boolean?,
  ][] = [
    // name, backend, age (s), preview, project, messages, closed with base
    [
      'Fix flaky upload test',
      'claude',
      12 * 60,
      'The upload test fails one run in ten on CI, find out why',
      'web',
      14,
    ],
    [
      'Hero image sizes',
      'codex',
      2 * HOUR,
      'Make the hero image responsive and add srcset',
      'web',
      6,
    ],
    [
      'Rate limiter review',
      'claude',
      5 * HOUR,
      'Review the token bucket in middleware/rate_limit.rs',
      'api',
      9,
      true,
    ],
    [
      'Retry webhook delivery',
      'opencode',
      DAY + 3 * HOUR,
      'Retry failed webhooks with exponential backoff',
      'api',
      21,
    ],
    [
      'Changelog for 2.4',
      'claude',
      DAY + 9 * HOUR,
      'Write the changelog for 2.4 from the merged PRs',
      'docs',
      4,
    ],
    [
      'Cookie banner copy',
      'cursor',
      3 * DAY,
      'Shorten the cookie banner text, keep it GDPR compliant',
      'web',
      3,
    ],
    [
      'Tax rounding bug',
      'codex',
      5 * DAY,
      'Totals are off by one cent for some EU invoices',
      'api',
      17,
    ],
    [
      'API reference cleanup',
      'claude',
      6 * DAY,
      'Remove the deprecated v1 endpoints from the reference',
      'docs',
      8,
    ],
    [
      'Onboarding emails',
      'claude',
      12 * DAY,
      'Draft the three onboarding emails for new teams',
      'web',
      11,
    ],
    [
      'Load test plan',
      'pi',
      20 * DAY,
      'Plan a load test for 5k requests per second',
      'api',
      5,
    ],
    [
      'Image CDN migration',
      'codex',
      27 * DAY,
      'Move product images to the new CDN bucket',
      'web',
      26,
    ],
    [
      'Search ranking ideas',
      'claude',
      45 * DAY,
      'Collect ideas to rank guides above API pages',
      'docs',
      7,
    ],
    [
      'Legacy auth removal',
      'claude',
      80 * DAY,
      'Remove the old session-cookie auth path',
      'api',
      32,
    ],
  ]

  const contexts = {
    web: { project: web, worktree: webMain },
    api: { project: api, worktree: apiMain },
    docs: { project: docs, worktree: archivedWorktrees[2] },
  } as const

  const archivedSessions = sessionSeeds.map(
    ([name, backend, age, preview, key, count, baseClosed], index) => {
      const { project, worktree } = contexts[key as keyof typeof contexts]
      return {
        session: createSession({
          name,
          order: index,
          backend,
          message_count: count,
          archived_at: nowSeconds - age,
          ...(baseClosed ? { archived_by_base_close: true } : {}),
        }),
        worktree_id: worktree.id,
        worktree_name: worktree.name,
        worktree_path: worktree.path,
        project_id: project.id,
        project_name: project.name,
        last_message_preview: preview,
      }
    }
  )

  return {
    projects,
    worktrees: [webMain, apiMain],
    archivedWorktrees,
    archivedSessions,
  }
}
