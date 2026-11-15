import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(path, 'utf8')

test('server build workflow builds binaries and publishes docker image', () => {
  const workflow = read('.github/workflows/server-build.yml')

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /needs: metadata/)
  assert.match(workflow, /cd src-server && cargo build --release/)
  assert.match(workflow, /splitkick-server-linux-amd64/)
  assert.match(workflow, /splitkick-server-linux-arm64/)
  assert.match(workflow, /server-latest\.json/)
  assert.match(workflow, /docker\/build-push-action@v6/)
  assert.match(
    workflow,
    /IMAGE_NAME: \$\{\{ github\.repository_owner \}\}\/splitkick-server/
  )
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
  // Docker: only :<version>, no :latest.
  assert.match(workflow, /-t "\$\{IMAGE\}:\$\{VERSION\}"/)
  assert.doesNotMatch(workflow, /:latest"|create_manifest "latest"/)
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

test('Dockerfile builds and runs splitkick-server headlessly as non-root user', () => {
  const dockerfile = read('Dockerfile.server')

  assert.match(dockerfile, /bun run build/)
  assert.match(dockerfile, /COPY src-server \.\/src-server/)
  assert.match(dockerfile, /COPY jean-core \.\/jean-core/)
  assert.match(
    dockerfile,
    /cd src-server && RUSTC_WRAPPER= cargo build --release/
  )
  assert.match(dockerfile, /USER splitkick/)
  assert.match(dockerfile, /chown -R splitkick:splitkick \/home\/splitkick/)
  assert.match(dockerfile, /JEAN_HOST=0\.0\.0\.0/)
  assert.doesNotMatch(dockerfile, /webkit|gtk|appindicator|xvfb|xauth/i)
  assert.match(dockerfile, /splitkick-server-entrypoint/)
  assert.match(
    dockerfile,
    /ENTRYPOINT \["\/usr\/local\/bin\/splitkick-server-entrypoint"\]/
  )
  // The server version is its own Cargo version, not the desktop one.
  assert.doesNotMatch(dockerfile, /tauri\.fork\.conf\.json/)
  assert.equal(existsSync('src-server/build.rs'), false)
  assert.match(read('.dockerignore'), /^src-server\/target$/m)
})

test('server images keep data in the Splitkick data folder on a volume', () => {
  for (const file of ['Dockerfile.server', 'Dockerfile.server-runtime']) {
    const dockerfile = read(file)
    assert.match(
      dockerfile,
      /VOLUME \["\/home\/splitkick\/\.local\/share\/app\.splitkick\.desktop"\]/,
      file
    )
    assert.match(dockerfile, /EXPOSE 3460/, file)
    assert.doesNotMatch(dockerfile, /com\.jean\.desktop|jean-server/, file)
  }
})

/** Shared assertions: server images ship GitHub CLI from the official apt repo. */
function assertServerImageInstallsGh(dockerfile) {
  assert.match(
    dockerfile,
    /cli\.github\.com\/packages\/githubcli-archive-keyring\.gpg/
  )
  assert.match(dockerfile, /cli\.github\.com\/packages stable main/)
  assert.match(
    dockerfile,
    /apt-get update && apt-get install -y --no-install-recommends gh/
  )
  // Keep gh install in the same runtime package layer (no extra FROM/RUN stage).
  assert.match(
    dockerfile,
    /openssh-client[\s\S]*githubcli-archive-keyring[\s\S]*apt-get install -y --no-install-recommends gh[\s\S]*useradd/
  )
}

test('Dockerfile.server installs GitHub CLI for onboarding and PATH tools', () => {
  assertServerImageInstallsGh(read('Dockerfile.server'))
})

test('Dockerfile.server-runtime installs GitHub CLI for onboarding and PATH tools', () => {
  assertServerImageInstallsGh(read('Dockerfile.server-runtime'))
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

test('Docker entrypoint starts splitkick-server directly without a display server', () => {
  const entrypoint = read('scripts/docker-entrypoint.sh')

  assert.doesNotMatch(entrypoint, /Xvfb|DISPLAY|WAYLAND|sleep/i)
  assert.match(entrypoint, /exec splitkick-server "\$@"/)
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
