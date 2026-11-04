import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { manifestFor } from './updater-manifest.mjs'

const RELEASE = {
  version: '1.5.0',
  tag: 'splitkick-v1.5.0',
  repository: 'azeitler/splitkick',
  pubDate: '2026-11-05T10:00:00.000Z',
}

function folderWith(files) {
  const folder = mkdtempSync(join(tmpdir(), 'updater-manifest-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(folder, name), content)
  }
  return folder
}

test('lists macOS and Windows with their signatures and tag URLs', t => {
  const folder = folderWith({
    'Splitkick-aarch64.app.tar.gz': 'mac',
    'Splitkick-aarch64.app.tar.gz.sig': 'mac-sig\nline two',
    'Splitkick-x64-setup.exe': 'win',
    'Splitkick-x64-setup.exe.sig': 'win-sig',
  })
  t.after(() => rmSync(folder, { recursive: true }))

  assert.deepEqual(manifestFor({ folder, ...RELEASE }), {
    version: '1.5.0',
    notes: 'Splitkick 1.5.0',
    pub_date: '2026-11-05T10:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        signature: 'mac-sig\nline two',
        url: 'https://github.com/azeitler/splitkick/releases/download/splitkick-v1.5.0/Splitkick-aarch64.app.tar.gz',
      },
      'windows-x86_64': {
        signature: 'win-sig',
        url: 'https://github.com/azeitler/splitkick/releases/download/splitkick-v1.5.0/Splitkick-x64-setup.exe',
      },
    },
  })
})

test('leaves out a platform whose package has no signature', t => {
  const folder = folderWith({
    'Splitkick-aarch64.app.tar.gz': 'mac',
    'Splitkick-aarch64.app.tar.gz.sig': 'mac-sig',
    'Splitkick-x64-setup.exe': 'win',
  })
  t.after(() => rmSync(folder, { recursive: true }))

  const manifest = manifestFor({ folder, ...RELEASE })
  assert.deepEqual(Object.keys(manifest.platforms), ['darwin-aarch64'])
})

test('writes no feed when no package is signed', t => {
  const folder = folderWith({ 'Splitkick-aarch64.dmg': 'dmg' })
  t.after(() => rmSync(folder, { recursive: true }))

  assert.equal(manifestFor({ folder, ...RELEASE }), null)
})
