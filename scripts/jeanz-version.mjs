#!/usr/bin/env node
/**
 * Resolves the version of the next JeanZ release.
 *
 * A JeanZ build is the upstream product version plus this fork's own patch
 * suffix: 0.1.73-z.1, 0.1.73-z.2, 0.2.0-z.3 and so on. The counter is global
 * and never restarts, so a higher -z is always the newer build, even when
 * upstream jumps several versions between two JeanZ builds.
 *
 * The suffix is a semver prerelease field, so the result stays a valid semver
 * version. Tauri accepts it and writes it into the bundle.
 *
 * The dot in "-z.4" is required, not cosmetic. Semver compares a prerelease
 * field that contains a letter as ASCII text, so "z10" sorts below "z9" and
 * the updater would stop offering updates at the tenth build. Split into the
 * two identifiers "z" and "4", the number is compared numerically and the
 * order stays correct forever.
 *
 * Run without arguments to print `upstream=`, `version=`, `tag=` and
 * `sequence=` lines. Append the output to $GITHUB_OUTPUT in CI.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JEANZ_TAG = /^v?\d+\.\d+\.\d+-z\.(\d+)$/
const UPSTREAM_VERSION = /^\d+\.\d+\.\d+$/

/**
 * Highest -z suffix in a list of git refs or tag names. Everything that is not
 * a JeanZ tag is ignored, so upstream tags and the old `main-build` tag do not
 * disturb the count. Returns 0 when no JeanZ tag exists yet.
 */
export function highestSequence(refs) {
  let highest = 0

  for (const ref of refs) {
    const name = ref
      .trim()
      .replace(/^refs\/tags\//, '')
      // `git ls-remote --tags` also lists the peeled ref of annotated tags.
      .replace(/\^\{\}$/, '')
    const match = JEANZ_TAG.exec(name)

    if (match) {
      highest = Math.max(highest, Number(match[1]))
    }
  }

  return highest
}

/** `<upstream>-z.<highest + 1>`, for example 0.1.73-z.4. */
export function nextVersion(upstream, refs) {
  if (!UPSTREAM_VERSION.test(upstream)) {
    throw new Error(`Upstream version must look like 1.2.3, got: ${upstream}`)
  }

  return `${upstream}-z.${highestSequence(refs) + 1}`
}

function listRemoteTags(cwd) {
  const output = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
    cwd,
    encoding: 'utf8',
  })

  // Every line is `<sha>\t<ref>`.
  return output.split('\n').map(line => line.split('\t')[1] ?? '')
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const config = JSON.parse(
    readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')
  )
  const upstream = config.version
  const version = nextVersion(upstream, listRemoteTags(root))

  console.log(`upstream=${upstream}`)
  console.log(`version=${version}`)
  console.log(`tag=v${version}`)
  console.log(`sequence=${version.split('-z.')[1]}`)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
