/**
 * An agent: a named, unique role holder that points to exactly one current
 * session. Not a role: a role (`RoleProfile`) is a session preset that any
 * number of sessions can use. Mirrors the Rust `AgentView` (camelCase command
 * data). See `docs/developer/agents.md`.
 */
export interface Agent {
  id: string
  name: string
  /** Where the name is unique: the whole app, or one project. */
  scope: 'global' | 'project'
  /** The project the agent's workspace is in (to open its session). For a
   *  global agent this is its home, usually a hidden project. */
  projectId: string | null
  projectName: string | null
  roleId: string | null
  worktreeId: string
  worktreePath: string | null
  /** null = "No session": it was archived or deleted. */
  sessionId: string | null
  sessionName: string | null
  /** Earlier sessions, newest first. */
  pastSessionIds: string[]
  createdAt: number
}
