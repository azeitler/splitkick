import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(path, 'utf8')

test('server build workflow builds and tests the Linux binaries', () => {
  const workflow = read('.github/workflows/server-build.yml')

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /needs: metadata/)
  assert.match(workflow, /cd src-server && cargo build --release/)
  assert.match(workflow, /splitkick-server-linux-amd64/)
  assert.match(workflow, /splitkick-server-linux-arm64/)
  assert.match(workflow, /server-latest\.json/)
  // The binary must report the release version it is published under.
  assert.match(workflow, /\[ "\$reported" = "Splitkick \$VERSION" \]/)
  assert.match(workflow, /"serverVersion\\":\\"\$VERSION\\""/)
  assert.doesNotMatch(workflow, /jean-server/)
  assert.equal(existsSync('.github/workflows/server-release.yml'), false)
})

test('the server is published as its own pre-release, never latest', () => {
  const workflow = read('.github/workflows/server-build.yml')

  // Own version and tag, apart from the desktop splitkick-v<version>.
  assert.match(workflow, /src-server\/Cargo\.toml/)
  assert.doesNotMatch(workflow, /tauri\.fork\.conf\.json/)
  assert.match(workflow, /TAG="splitkick-server-v\$VERSION"/)
  assert.match(workflow, /\*-pre\.\*\) ;;/)
  // The desktop updater reads releases/latest: never take it over.
  assert.match(workflow, /gh release create "\$RELEASE_TAG"/)
  assert.match(workflow, /--prerelease \\/)
  assert.match(workflow, /--latest=false \\/)
  assert.doesNotMatch(workflow, /gh release upload/)
  // No Docker image: agents must run on the host itself.
  assert.doesNotMatch(workflow, /docker|ghcr|packages: write/i)
  assert.doesNotMatch(workflow, /workflow_call:/)
})

test('a desktop release does not build the server (own pre-release track)', () => {
  const ci = read('.github/workflows/ci-build.yml')
  const server = read('.github/workflows/server-build.yml')

  assert.doesNotMatch(ci, /server-build\.yml/)
  assert.match(server, /workflow_dispatch:/)
})

test('native release workflow does not require a previous CI build', () => {
  const workflow = read('.github/workflows/release.yml')

  assert.doesNotMatch(workflow, /workflow_id: 'ci-build\.yml'/)
  assert.match(workflow, /needs: prepare-release/)
})

test('there is no Docker image for the server', () => {
  for (const file of [
    'Dockerfile.server',
    'Dockerfile.server-runtime',
    'scripts/docker-entrypoint.sh',
    '.dockerignore',
  ]) {
    assert.equal(existsSync(file), false, file)
  }
  // The version comes from src-server/Cargo.toml, not the desktop config.
  assert.equal(existsSync('src-server/build.rs'), false)
})

test('splitkick-server depends only on the Tauri-free shared core', () => {
  const cargoToml = read('src-tauri/Cargo.toml')
  const coreCargoToml = read('jean-core/Cargo.toml')
  const serverCargoToml = read('src-server/Cargo.toml')

  assert.doesNotMatch(cargoToml, /splitkick-server/)
  assert.match(cargoToml, /jean-core = \{ path = "\.\.\/jean-core" \}/)
  assert.match(serverCargoToml, /name = "splitkick-server"/)
  assert.match(serverCargoToml, /jean-core = \{ path = "\.\.\/jean-core" \}/)
  assert.doesNotMatch(serverCargoToml, /src-tauri|tauri/i)
  assert.doesNotMatch(coreCargoToml, /tauri|wry|webkit|gtk/i)
})

test('shared dispatcher is owned by jean-core and used by the desktop adapter', () => {
  const commandPattern = /^\s*"([a-zA-Z0-9_:-]+)"\s*=>/gm
  const commands = source =>
    [...source.matchAll(commandPattern)].map(match => match[1]).sort()

  const coreCommands = commands(read('jean-core/src/http_server/dispatch.rs'))
  const desktopAdapter = read('src-tauri/src/lib.rs')
  const frontendTransport = read('src/lib/transport.ts')

  assert.ok(coreCommands.length >= 380)
  assert.match(desktopAdapter, /dispatch_core_command/)
  assert.match(frontendTransport, /dispatch_core_command/)
  assert.equal(existsSync('src-tauri/src/http_server/dispatch.rs'), false)
  assert.equal(existsSync('src-tauri/src/chat'), false)
  assert.equal(existsSync('src-tauri/src/projects'), false)
})
