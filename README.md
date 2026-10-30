<div align="center">

<img src="docs/logo.svg" alt="" width="96" height="96" />

# claude-locator

**Hold <kbd>⌥ Option</kbd> and click anything in your running app. Land on the line that drew it — in any framework, with any coding agent: Claude, Cursor, VS Code, Zed, OpenCode or Codex.**

[![npm](https://img.shields.io/npm/v/vite-plugin-claude-locator?color=d97757)](https://www.npmjs.com/package/vite-plugin-claude-locator)
[![CI](https://github.com/scs0209/claude-locator/actions/workflows/ci.yml/badge.svg)](https://github.com/scs0209/claude-locator/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/scs0209/claude-locator)](LICENSE)

[**Try the demo →**](https://scs0209.github.io/claude-locator/) · [Install](#install) · [Frameworks](#frameworks) · [Where it opens](#where-it-opens) · [How it works](#how-it-works)

<img src="docs/demo.gif" alt="Option+hover outlines an element with its file and line; Option+click opens it; Option+right-click lists the components above it" width="880" />

</div>

## Why

You see the bug on the page; your agent needs the file. claude-locator turns "the price on the second card" into `src/components/ProductCard.tsx:12`, opened where you and your agent work — without the React DevTools extension, and inside the built-in browsers of coding agents, which do not hand `vscode://` or `cursor://` links to your editor.

The name comes from where it started, the Claude desktop app. It is not tied to Claude.

- **⌥ + hover** outlines the element, with its component and `file:line`, or a muted **no source here** label when no location is available
- **⌥ + click** opens that line
- **⌥ + right-click** lists the element and every component above it; open any of them
- **React, Vue, Svelte, Solid, Preact, Astro and Angular** (React 18 and 19, Astro 5 and 7)
- **Opens in** the Claude desktop app's Files pane, your editor, OpenCode's prompt, the clipboard (Codex and any agent), a URL or a function of yours
- **Development only.** Nothing ships in `vite build`, and the click never reaches your app

> **Claude desktop app with React?** The app's preview has its own element picker: it hands Claude the component, its source location, the HTML, styles and a screenshot, with nothing to install. Use that. claude-locator is for the rest: **Vue, Svelte, Solid, Preact, Astro and Angular** (where the picker finds no source), **other agents and editors** (Cursor, VS Code, Zed, OpenCode, Codex), **any browser**, and **opening the file itself** at the line, with the component tree to move up from there.

## Install

```bash
npm install -D vite-plugin-claude-locator
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import claudeLocator from 'vite-plugin-claude-locator'

export default defineConfig({
  plugins: [react(), claudeLocator()],
})
```

Then pick [where it opens](#where-it-opens). The default, `'claude'`, also needs the Claude Code plugin:

```
/plugin install claude-locator --marketplace scs0209/claude-locator
```

<details>
<summary>Other ways to install the Claude Code plugin</summary>

At the prompt of a Claude Code terminal session, the line above; answer `y` to add the marketplace and pick a scope (the user scope loads it in every session, the desktop app's included).

From a shell:

```bash
claude plugin install claude-locator --marketplace scs0209/claude-locator
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `scs0209/claude-locator`, then **Add plugin**.

</details>

## Frameworks

| Framework | Setup | Element → line | Component tree |
| --- | --- | --- | --- |
| **React** 18 · 19 | Vite plugin | ✅ JSX transform | ✅ fiber chain, with where each component is defined |
| **Vue** 3 | Vite plugin | ✅ `.vue` template transform | ✅ component instances, with their files |
| **Svelte** 5 | Vite plugin | ✅ Svelte's own dev records | ✅ each component usage |
| **Solid** · **Preact** | Vite plugin | ✅ JSX transform | ✅ by file |
| **Astro** 5 · 7 | `vite-plugin-claude-locator/astro` | ✅ `.astro` template transform, and the islands | ✅ islands, then the `.astro` files around them |
| **Angular** 20 | standalone server + page script | ✅ the owning component's class | ✅ component hosts |
| Anything else (webpack, Next.js, …) | standalone server + page script | elements tagged by your build, or nothing | by file |

<details>
<summary><b>Astro</b></summary>

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import claudeLocator from 'vite-plugin-claude-locator/astro'

export default defineConfig({
  integrations: [claudeLocator()],
})
```

The integration adds the Vite plugin in `astro dev` only and injects the page script. Astro 7 runs `astro dev` in the background: after changing the config, `astro dev stop` before starting again.

</details>

<details>
<summary><b>Angular</b>, and other dev servers that take no Vite plugin</summary>

The Angular CLI dev server takes no Vite plugins, so the endpoint runs on its own port and the page script is loaded from your code:

```bash
npx claude-locator              # http://127.0.0.1:5678, beside `ng serve`
```

```ts
// main.ts
import { isDevMode } from '@angular/core'

if (isDevMode()) {
  import('vite-plugin-claude-locator/client').then((m) => m.startClaudeLocator())
}
```

Angular in development records each component class's file and line (`ɵcmp.debugInfo`); a click opens the class of the component that owns the element. Template lines are not recorded.

`npx claude-locator --help` lists the options (`--open claude,editor,opencode`, `--editor cursor`, `--root`, `--port`). It answers pages served from this machine only (`localhost`, `127.0.0.1`).

</details>

## Where it opens

```ts
claudeLocator({ open: ['claude', 'editor'], editor: 'cursor' })
```

| `open` | Opens in | Needs |
| --- | --- | --- |
| `'claude'` *(default)* | the Claude desktop app's **Files pane**, next to your session | the Claude Code plugin |
| `'editor'` | **Cursor, VS Code, Windsurf**: a tab in the window you are using. **Zed, WebStorm**, …: through their launcher | `editor: 'cursor'` (or `code`, `zed`, …) |
| `'opencode'` | the **OpenCode** TUI's prompt, as `src/Counter.tsx:6` | `opencode --port 4096` |
| `'clipboard'` | the clipboard, to paste into **Codex** or any agent | — |
| `{ url }` | a URL the page opens: `vscode://file/{absolutePath}:{line}`, a GitHub link, … | — |
| a function | anything: `(location) => { … }` on the dev server | — |

Use several at once. Each click is logged by the dev server (`[claude-locator] src/Counter.tsx:6 → claude, editor`); a target that fails logs a warning and does not stop the others.

<details>
<summary>Details per target</summary>

- **Claude desktop.** The page posts the location to the dev server, which writes `node_modules/.cache/claude-locator/open.json` at the workspace root; the Claude Code plugin watches that file and calls the app's `show_pane`. The file must be inside the session's folder.
- **Cursor, VS Code, Windsurf.** Run directly with `-r -g <file>:<line>:<column>`: the file opens in the window you used last, which is the one you are clicking in when its built-in browser shows your app. The tab shows a second or so after the click. `editorWindow: 'project'` opens the workspace's window instead. On macOS the launcher inside the installed app is preferred: the same name on `PATH` can be an agent CLI (Cursor's agent installs a `~/.local/bin/cursor` shim that does not open files).
- **Other editors** go through [`launch-editor`](https://github.com/vitejs/launch-editor), as Vite's own `/__open-in-editor` does. Without `editor`: `LAUNCH_EDITOR`, then `EDITOR`, then the running editor decides.
- **OpenCode.** `POST /tui/append-prompt` on the OpenCode server (`opencodeUrl`, default `http://127.0.0.1:4096`). The TUI picks a random port unless started with `--port`. The OpenCode desktop app does not act on that call.
- **Codex, and agents without an API for it.** Neither the Codex app nor the OpenCode desktop app offers, as of this writing, a way for another program to show a file in their panes (the Codex app's `codex://` links open Settings; OpenCode desktop's `opencode://` links open a project or a session). Use `'clipboard'` and paste, plus `'editor'` to read the file.
- **Format.** `locationFormat` sets what `'clipboard'` and `'opencode'` write: `{path}` (relative to the workspace), `{absolutePath}`, `{line}`, `{column}`. Default `{path}:{line}`; e.g. `'@{path}#L{line}'`.
- **In the page.** Each opened location is also dispatched on `window` as `claude-locator:open` (`event.detail` is `{ file, line, column }`).

Verified on macOS: the Claude desktop app's Files pane; Cursor's built-in browser opening a tab in the same window; the clipboard; the OpenCode TUI prompt (OpenCode 1.18). Other editors and the Codex app have not been tried with this plugin.

</details>

## How it works

```
 page                                dev server (or `npx claude-locator`)        where you work
 ────                                ────────────────────────────────────        ──────────────
 ⌥ + click <button>
   │ the source, nearest first:
   │   data-claude-source  ← added at transform time (JSX, .vue, .astro)
   │   __svelte_meta       ← Svelte dev mode
   │   fiber._debugSource  ← React 18, when nothing else is there
   │   ng debugInfo        ← Angular dev mode
   │
   ├─ clipboard, { url } targets: done in the page
   └─ POST /__claude-open ──────────▶ inside the workspace? exists?
        ?file=src/App.tsx&line=12     ├─ 'claude'   → open.json ──────────────▶ Claude Code plugin → Files pane
                                      ├─ 'editor'   → cursor -r -g file:line ─▶ Cursor / VS Code / Zed …
                                      └─ 'opencode' → /tui/append-prompt ─────▶ OpenCode TUI prompt
```

<details>
<summary>More on finding the source</summary>

- **Elements.** At transform time, before `@vitejs/plugin-react`, `plugin-vue` or Astro's compiler see the file, every plain element (`<div>`, `<button>`) gets `data-claude-source="<path>:<line>:<column>"` — positions from the file as you wrote it. JSX is parsed with `@babel/parser`; `.vue` templates with your project's `@vue/compiler-sfc`; `.astro` files with Astro's own compiler (`@astrojs/compiler`, or `@astrojs/compiler-rs` on Astro 7). Component elements (`<Button>`) are not tagged: they may not pass unknown props to the DOM.
- **Components.** The JSX transform also records each top-level component (`function Card`, `memo(...)`, `forwardRef`, classes) as a non-enumerable `__claudeSource = { name, source }` on the component. The tree reads it from React's fibers, so it works on React 18 and 19, keeps declared names that bundlers rename (`memo(function Panel)` comes out as `Panel2`), and survives a production build.
- **Why not `_debugSource`?** React 19 removed it, and with `@vitejs/plugin-react` 4.x its lines are shifted by the React Refresh code prepended before the JSX is compiled (a `<button>` on line 6 reports line 25). It is only the fallback.
- **The endpoint** refuses files outside the workspace or that do not exist (400), cross-site requests (403), and on the standalone server any page not served from this machine.

</details>

## Options

```ts
claudeLocator({
  open: ['claude'],                 // 'claude' | 'editor' | 'opencode' | 'clipboard' | { url } | fn, or a list
  editor: 'cursor',                 // launcher for 'editor'; default LAUNCH_EDITOR, EDITOR, then a guess
  editorWindow: 'reuse',            // VS Code family: 'reuse' (the window used last) | 'project'
  locationFormat: '{path}:{line}',  // for 'clipboard' and 'opencode'
  opencodeUrl: 'http://127.0.0.1:4096',
  modifier: 'alt',                  // 'alt' | 'ctrl' | 'meta' | 'shift'
  workspaceRoot: '/abs/path',       // default: Vite's workspace root (monorepo root, else project root)
  signalFile: 'node_modules/.cache/claude-locator/open.json',
  jsxSource: true,                  // the transforms; React 18 falls back to _debugSource without them
  exclude: [/\.stories\.tsx$/],     // files the transforms skip
  injectClient: true,               // add the page script to index.html; else import 'virtual:claude-locator/client'
  inBuild: false,                   // also run in `vite build` — for demos only, never production
  patchDevtoolsHook: false,         // fix __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers for LocatorJS without the extension
})
```

## Limits

- **The Claude Code plugin API is early access.** Hooks modules and the desktop app's `ccd_view` tool may change between Claude Code releases without notice, and the `'claude'` target may stop working until the plugin is updated. Written against Claude Code 2.1.309.
- **`'claude'` needs the desktop app**, with the session open in a window and the file inside its folder; the dev server's workspace root must be the session folder or below it. Every session watching that folder opens the file.
- **Needs a keyboard.** No touch gesture yet.
- **Angular** opens component classes, not template lines.
- **Tested versions** (sample apps in `examples/`): React 18.3 and 19, Vue 3.5, Svelte 5, Solid 1.9, Preact 10, Astro 5.18 and 7.4, Angular 20. Svelte 4 keeps the same element records, so element lines should work there too, without the component chain; Astro 6 has not been tried.
- Only top-level components get a definition in the tree. Lowercase JSX tags that are not DOM elements (`@react-three/fiber`'s `<mesh>`) get the attribute too; list such files in `exclude`.

## Troubleshooting

### Option+click does nothing

Check the dev server output for a `[claude-locator]` line (with the standalone server, `npx claude-locator`, it shows up in that server's terminal). If there is no line, the click did not reach the server: check that the page script loaded (`window.__claudeLocator` exists in the page) and that the page is using the correct server port.

### The Claude Files pane does not open

Make sure the Claude desktop session is open in a window, the file is inside that session's folder, and the Claude Code plugin is installed.

### Cursor opens nothing

The `cursor` command on `PATH` may be an agent CLI shim rather than the app launcher. Set `editor: 'cursor'` in the plugin options so claude-locator uses the installed app launcher. That fallback is macOS-only; elsewhere, put the IDE's own launcher on `PATH` or pass its full path as `editor`.

### The editor tab appears a second later

This is expected. The launcher hands the file to the already-running editor, which may take a moment to show the tab.

### Astro 7 does not pick up config changes

Astro 7 runs `astro dev` in the background. Stop it with `astro dev stop` before starting it again after changing the config.

## Develop

```bash
pnpm install
pnpm build && pnpm test          # the samples use the built package
claude plugin test plugin        # the Claude Code plugin's tests
pnpm dev:react19                 # or: pnpm --filter example-{react18,vue,svelte,solid,preact,astro,angular,demo} dev
CLAUDE_LOCATOR_OPEN=claude,editor CLAUDE_LOCATOR_EDITOR=cursor pnpm dev:react19
node scripts/record-demo.mjs     # re-record docs/demo.gif from the demo site
```

Try the Claude Code plugin from this folder without installing it: `claude --plugin-dir ./plugin`.

## License

MIT. The demo site uses the design tokens of [OpenDesign's Mono design system](https://github.com/nexu-io/open-design/tree/main/design-systems/mono) (Apache-2.0).
