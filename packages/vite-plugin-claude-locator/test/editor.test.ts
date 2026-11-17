import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { editorOpener, isVscodeFamily, resolveLauncher } from '../src/editor'

const signal = { file: '/repo/src/App.tsx', line: 12, column: 3, at: 1 }

describe('resolveLauncher', () => {
  it("prefers the app bundle's own launcher on macOS", () => {
    expect(resolveLauncher('cursor', 'darwin', () => true)).toBe('/Applications/Cursor.app/Contents/Resources/app/bin/cursor')
    expect(resolveLauncher('code', 'darwin', () => true)).toBe(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    )
  })

  it('keeps the name when the app is not installed, on other platforms, and for other editors', () => {
    expect(resolveLauncher('cursor', 'darwin', () => false)).toBe('cursor')
    expect(resolveLauncher('cursor', 'linux', () => true)).toBe('cursor')
    expect(resolveLauncher('zed', 'darwin', () => true)).toBe('zed')
    expect(resolveLauncher(undefined, 'darwin', () => true)).toBeUndefined()
  })
})

describe('isVscodeFamily', () => {
  it('knows VS Code and the editors built on it, by launcher name or path', () => {
    expect(isVscodeFamily('/Applications/Cursor.app/Contents/Resources/app/bin/cursor')).toBe(true)
    expect(isVscodeFamily('code')).toBe(true)
    expect(isVscodeFamily('windsurf')).toBe(true)
    expect(isVscodeFamily('zed')).toBe(false)
  })
})

describe('editorOpener', () => {
  const workspaceRoot = '/repo'

  it('opens VS Code-family editors in the window used last, by default', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn() }))
    const launch = vi.fn()
    await editorOpener('code', { workspaceRoot, spawn, launch })(signal)
    expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/code$/), ['-r', '-g', '/repo/src/App.tsx:12:3'])
    expect(launch).not.toHaveBeenCalled()
  })

  it("opens them in the workspace's window when asked", async () => {
    const spawn = vi.fn(() => ({ on: vi.fn() }))
    await editorOpener('cursor', { workspaceRoot, window: 'project', spawn })(signal)
    expect(spawn).toHaveBeenCalledWith(expect.stringMatching(/cursor$/), ['/repo', '-g', '/repo/src/App.tsx:12:3'])
  })

  it('hands other editors to launch-editor with the line and column', async () => {
    const launch = vi.fn()
    await editorOpener('zed', { workspaceRoot, launch })(signal)
    expect(launch).toHaveBeenCalledWith('/repo/src/App.tsx:12:3', 'zed', expect.any(Function))
  })

  it('opens line 1 when the click has no line', async () => {
    const launch = vi.fn()
    await editorOpener(undefined, { workspaceRoot, launch })({ file: '/repo/src/App.tsx', at: 1 })
    expect(launch).toHaveBeenCalledWith('/repo/src/App.tsx:1:1', undefined, expect.any(Function))
  })

  it('rejects when launch-editor cannot find the editor', async () => {
    const launch = vi.fn((file: string, _editor?: string, onError?: (name: string, message: string | null) => void) =>
      onError?.(file, 'not found'),
    )
    await expect(editorOpener('nope', { workspaceRoot, launch })(signal)).rejects.toThrow(
      'could not open /repo/src/App.tsx:12:3 in an editor: not found',
    )
  })

  // This subprocess fixture is POSIX-only; the mocked spawn tests above verify the launcher arguments on Windows.
  it.skipIf(process.platform === 'win32')(
    'runs a real VS Code-family launcher with the workspace and the position',
    async () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-locator-code-'))
      const record = path.join(folder, 'args.txt')
      const fakeCode = path.join(folder, 'code')
      fs.writeFileSync(fakeCode, `#!/bin/sh\necho "$@" > "${record}"\n`, { mode: 0o755 })

      await editorOpener(fakeCode, { workspaceRoot: '/repo', window: 'project' })(signal)
      await vi.waitFor(() =>
        expect(fs.existsSync(record) && fs.readFileSync(record, 'utf8')).toBe('/repo -g /repo/src/App.tsx:12:3\n'),
      )
      fs.rmSync(folder, { recursive: true, force: true })
    },
  )

  it('runs the real launcher with the file it was given', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-locator-editor-'))
    const record = path.join(folder, 'args.txt')
    const fakeEditor = path.join(folder, `fake-editor${process.platform === 'win32' ? '.cmd' : ''}`)
    const launcher =
      process.platform === 'win32'
        ? `@echo off\r\n> "${record}" echo %*\r\n`
        : `#!/bin/sh\necho "$@" > "${record}"\n`
    fs.writeFileSync(fakeEditor, launcher, { mode: 0o755 })
    // launch-editor skips a file that does not exist
    const source = path.join(folder, 'App.tsx')
    fs.writeFileSync(source, '')

    const editor = process.platform === 'win32' ? `"${fakeEditor}"` : fakeEditor
    await editorOpener(editor, { workspaceRoot: folder })({ ...signal, file: source })
    await vi.waitFor(() => expect(fs.existsSync(record)).toBe(true))
    expect(fs.readFileSync(record, 'utf8')).toContain(source)
    fs.rmSync(folder, { recursive: true, force: true })
  })
})
