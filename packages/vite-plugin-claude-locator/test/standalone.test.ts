import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findWorkspaceRoot, isLoopbackOrigin, startStandaloneServer } from '../src/standalone'

let workspace: string
let close: (() => Promise<void>) | undefined

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-locator-standalone-')))
  fs.writeFileSync(path.join(workspace, 'pnpm-workspace.yaml'), 'packages: [apps/*]\n')
  fs.mkdirSync(path.join(workspace, 'apps/web/src/app'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'apps/web/src/app/counter.ts'), 'export class Counter {}\n')
})

afterEach(async () => {
  await close?.()
  close = undefined
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe('isLoopbackOrigin', () => {
  it('allows pages on this machine only', () => {
    expect(isLoopbackOrigin('http://localhost:4200')).toBe(true)
    expect(isLoopbackOrigin('http://app.localhost:3000')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:5173')).toBe(true)
    expect(isLoopbackOrigin('https://example.com')).toBe(false)
    expect(isLoopbackOrigin('http://localhost.example.com')).toBe(false)
    expect(isLoopbackOrigin('null')).toBe(false)
  })
})

describe('findWorkspaceRoot', () => {
  it('finds the monorepo root above an app', () => {
    expect(findWorkspaceRoot(path.join(workspace, 'apps/web'))).toBe(workspace)
  })
})

describe('startStandaloneServer', () => {
  const start = async () => {
    const lines: string[] = []
    const server = await startStandaloneServer({ root: path.join(workspace, 'apps/web'), port: 0, log: (line) => lines.push(line) })
    close = server.close
    return { url: server.url, lines }
  }

  it('takes a path relative to the app, writes the signal at the workspace root, and answers with CORS', async () => {
    const { url, lines } = await start()
    const response = await fetch(`${url}/__claude-open?file=src/app/counter.ts&line=1`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:4200' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4200')
    const signal = JSON.parse(fs.readFileSync(path.join(workspace, 'node_modules/.cache/claude-locator/open.json'), 'utf8'))
    expect(signal.file).toBe(path.join(workspace, 'apps/web/src/app/counter.ts'))
    const relativeFile = path.join('apps', 'web', 'src', 'app', 'counter.ts')
    expect(lines).toContain(`[claude-locator] ${relativeFile}:1 → claude`)
  })

  it('refuses pages from elsewhere', async () => {
    const { url } = await start()
    const response = await fetch(`${url}/__claude-open?file=src/app/counter.ts`, {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    })
    expect(response.status).toBe(403)
  })
})
