import { existsSync } from 'node:fs'
import {
  createRepo,
  createSession,
  ENV_FILE,
  seedProject,
  writeEnv,
} from './helpers'
import { freePort, prepareInstance, startInstance } from './launcher'

/** Start sealed instances A (local) and B (remote) and seed fixture data. */
export default async function globalSetup(): Promise<void> {
  // E2E_REUSE=1 with E2E_LOCAL_RUN_DIR: run against instances that are
  // still up from an earlier run (fast loop while writing a scenario).
  if (process.env.E2E_REUSE === '1' && existsSync(ENV_FILE)) return
  const [portA, portB] = [await freePort(), await freePort()]
  const a = prepareInstance('a', portA)
  const b = prepareInstance('b', portB)
  // Each page calls the other instance's /api/invoke (transfer, remote
  // connection), so each allows the other's origin.
  await startInstance(a, [b.url])
  await startInstance(b, [a.url])

  const alphaA = await seedProject(a, createRepo(a, 'alpha'), 'feature-a')
  const alphaB = await seedProject(b, createRepo(b, 'alpha'), 'feature-b')
  const bMarkerSessionId = await createSession(b, alphaB, 'B-only marker')

  writeEnv({ a, b, alphaA, alphaB, bMarkerSessionId })
}
