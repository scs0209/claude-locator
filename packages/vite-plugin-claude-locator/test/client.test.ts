// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startClaudeLocator, type ClientApi, type ClientOptions } from '../src/client'

const options: ClientOptions = {
  endpoint: '/base/__claude-open',
  copyFormat: null,
  workspaceRoot: '/repo',
  projectRoot: '/repo/app',
  modifier: 'altKey',
  attribute: 'data-claude-source',
  componentProperty: '__claudeSource',
}

let api: ClientApi | undefined

afterEach(() => {
  api?.dispose()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

// The page gets the function's source text, not the module: run it that way
const startInlined = (): ClientApi => new Function(`return (${startClaudeLocator.toString()})(${JSON.stringify(options)})`)()

const attachFiber = (element: Element, fiber: object): void => {
  Object.assign(element, { '__reactFiber$abc123': fiber })
}

describe('findSource', () => {
  it('runs when inlined as source text', () => {
    api = startInlined()
    expect(typeof api.findSource).toBe('function')
  })

  it('reads React 18 _debugSource from the fiber', () => {
    api = startClaudeLocator(options)
    const button = document.createElement('button')
    attachFiber(button, { _debugSource: { fileName: '/repo/src/App.tsx', lineNumber: 7, columnNumber: 3 } })
    expect(api.findSource(button)).toEqual({ file: '/repo/src/App.tsx', line: 7, column: 3 })
  })

  it('follows _debugOwner out of node_modules to the component in your code', () => {
    api = startClaudeLocator(options)
    const button = document.createElement('button')
    const owner = { _debugSource: { fileName: '/repo/src/Page.tsx', lineNumber: 20, columnNumber: 9 } }
    attachFiber(button, {
      _debugSource: { fileName: '/repo/node_modules/ui/Button.js', lineNumber: 1 },
      _debugOwner: owner,
    })
    expect(api.findSource(button)).toEqual({ file: '/repo/src/Page.tsx', line: 20, column: 9 })
  })

  it('reads the data attribute when the fiber has no source (React 19)', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML = '<section data-claude-source="src/App.tsx:4:5"><b id="inner">x</b></section>'
    const inner = document.getElementById('inner') as Element
    attachFiber(inner, { _debugStack: new Error() })
    expect(api.findSource(inner)).toEqual({ file: 'src/App.tsx', line: 4, column: 5 })
  })

  it('prefers an ancestor attribute over a fiber _debugSource, whose lines other transforms may shift', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML = '<div data-claude-source="src/App.tsx:6:5"><button id="b">x</button></div>'
    const button = document.getElementById('b') as Element
    attachFiber(button, { _debugSource: { fileName: '/repo/src/App.tsx', lineNumber: 25, columnNumber: 5 } })
    expect(api.findSource(button)).toEqual({ file: 'src/App.tsx', line: 6, column: 5 })
  })

  it('finds nothing outside React', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML = '<p id="plain">x</p>'
    expect(api.findSource(document.getElementById('plain') as Element)).toBeUndefined()
  })
})

describe('Option+hover', () => {
  it('shows a muted no-source outline and restores source styling', () => {
    api = startInlined()
    document.body.innerHTML = '<p>plain</p>'
    const plain = document.querySelector('p') as Element
    plain.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, altKey: true }))

    const box = Array.from(document.querySelectorAll<HTMLElement>('[data-claude-locator]')).find(
      (element) => element.getAttribute('role') !== 'menu',
    )!
    const label = box.firstElementChild as HTMLElement
    expect(box.style.display).toBe('block')
    expect(label.textContent).toBe('no source here')
    expect(box.style.borderColor).toBe('#6b6560')
    expect(label.style.backgroundColor).toBe('#6b6560')

    document.body.innerHTML += '<button data-claude-source="src/App.tsx:4:5">button</button>'
    const button = document.querySelector('button') as Element
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, altKey: true }))
    expect(label.textContent).toContain('src/App.tsx:4')
    expect(box.style.borderColor).toBe('#d97757')
    expect(label.style.backgroundColor).toBe('#d97757')
  })
})

describe('Option+click', () => {
  it('posts the location to the endpoint and stops the click reaching the app', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    api = startClaudeLocator(options)
    document.body.innerHTML = '<a href="/x" data-claude-source="src/App.tsx:4:5">link</a>'
    const link = document.querySelector('a') as Element
    const appClick = vi.fn()
    link.addEventListener('click', appClick)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true, button: 0 })
    link.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(appClick).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/base/__claude-open?file=src%2FApp.tsx&line=4&column=5', { method: 'POST' })
  })

  it('leaves a click without the modifier alone', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api = startClaudeLocator(options)
    document.body.innerHTML = '<button data-claude-source="src/App.tsx:4:5">b</button>'
    const appClick = vi.fn()
    const button = document.querySelector('button') as Element
    button.addEventListener('click', appClick)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(appClick).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a second start replaces the first instead of doubling listeners', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    startClaudeLocator(options)
    api = startClaudeLocator(options)
    document.body.innerHTML = '<i data-claude-source="src/App.tsx:1:1">i</i>'
    ;(document.querySelector('i') as Element).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// A component function as the transform leaves it
const component = (name: string, where?: string): (() => null) => {
  const fn = { [name]: () => null }[name]
  if (where) {
    Object.defineProperty(fn, '__claudeSource', { value: { name, source: where } })
  }
  return fn
}

describe('findTree', () => {
  const mountTree = () => {
    document.body.innerHTML = '<button data-claude-source="src/Counter.tsx:6:5">b</button>'
    const button = document.querySelector('button') as Element
    const counter = component('Counter', 'src/Counter.tsx:3:1')
    // A bundler renamed the function inside `memo` (`Card2`); the recorded name wins
    const card = component('Card2')
    const memoCard = { type: card, $$typeof: Symbol.for('react.memo'), __claudeSource: { name: 'Card', source: 'src/Card.tsx:1:1' } }
    const libraryButton = component('LibraryButton')
    const appFiber = { type: component('App', 'src/App.tsx:3:1'), return: { type: Symbol.for('react.strict_mode') } }
    const memoInner = { type: card, elementType: memoCard, return: appFiber }
    const memoOuter = { type: memoCard, return: memoInner }
    const libraryFiber = { type: libraryButton, return: memoOuter }
    const counterFiber = { type: counter, return: libraryFiber }
    attachFiber(button, { type: 'button', return: counterFiber })
    return button
  }

  it('lists the element, then each component above it with where it is defined', () => {
    api = startClaudeLocator(options)
    expect(api.findTree(mountTree())).toEqual([
      { label: '<button>', source: { file: 'src/Counter.tsx', line: 6, column: 5 } },
      { label: 'Counter', source: { file: 'src/Counter.tsx', line: 3, column: 1 } },
      { label: 'LibraryButton', source: undefined },
      { label: 'Card', source: { file: 'src/Card.tsx', line: 1, column: 1 } },
      { label: 'App', source: { file: 'src/App.tsx', line: 3, column: 1 } },
    ])
  })

  it('uses _debugSource for components the transform did not tag (React 18)', () => {
    api = startClaudeLocator(options)
    const div = document.createElement('div')
    attachFiber(div, {
      type: 'div',
      return: { type: component('Panel'), _debugSource: { fileName: '/repo/src/App.tsx', lineNumber: 9 } },
    })
    expect(api.findTree(div)[1]).toEqual({ label: 'Panel', source: { file: '/repo/src/App.tsx', line: 9, column: undefined } })
  })

  it('opens a row of the menu shown on Option+right-click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    api = startClaudeLocator(options)
    const button = mountTree()
    const appMenu = vi.fn()
    button.addEventListener('contextmenu', appMenu)

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, altKey: true, clientX: 10, clientY: 10 })
    button.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(appMenu).not.toHaveBeenCalled()

    const rows = [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]
    expect(rows.map((row) => row.textContent)).toEqual([
      '<button>src/Counter.tsx:6',
      'Countersrc/Counter.tsx:3',
      'LibraryButtonnot in project',
      'Cardsrc/Card.tsx:1',
      'Appsrc/App.tsx:3',
    ])
    expect(rows[2].disabled).toBe(true)

    rows[3].click()
    expect(fetchMock).toHaveBeenCalledWith('/base/__claude-open?file=src%2FCard.tsx&line=1&column=1', { method: 'POST' })
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
  })

  it('leaves a right-click without the modifier to the app', () => {
    api = startClaudeLocator(options)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    mountTree().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('clipboard', () => {
  const clickWithModifier = (element: Element): void => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
  }

  it('copies the location in the format asked, workspace-relative, and still sends it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    api = startClaudeLocator({ ...options, copyFormat: '@{path}#L{line}' })
    document.body.innerHTML = '<i data-claude-source="src/App.tsx:4:5">i</i>'
    clickWithModifier(document.querySelector('i') as Element)
    expect(writeText).toHaveBeenCalledWith('@src/App.tsx#L4')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('makes an absolute fiber path relative, and fills absolutePath and column', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    api = startClaudeLocator({ ...options, endpoint: null, copyFormat: '{path} {absolutePath} {line}:{column}' })
    const button = document.createElement('button')
    attachFiber(button, { _debugSource: { fileName: '/repo/src/App.tsx', lineNumber: 7, columnNumber: 3 } })
    document.body.appendChild(button)
    expect(await api.open(api.findSource(button)!)).toBe(true)
    expect(writeText).toHaveBeenCalledWith('src/App.tsx /repo/src/App.tsx 7:3')
  })

  it('calls no endpoint when the clipboard is the only target', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    api = startClaudeLocator({ ...options, endpoint: null, copyFormat: '{path}:{line}' })
    expect(await api.open({ file: 'src/App.tsx', line: 1 })).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a copy the browser refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    document.execCommand = vi.fn(() => false)
    api = startClaudeLocator({ ...options, endpoint: null, copyFormat: '{path}:{line}' })
    expect(await api.open({ file: 'src/App.tsx', line: 1 })).toBe(false)
  })
})

describe('findTree beyond React', () => {
  it('Svelte: the element from __svelte_meta, then each component usage, paths from the project root', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML = '<button>b</button>'
    const button = document.querySelector('button') as Element
    Object.assign(button, {
      __svelte_meta: {
        loc: { file: 'src/Counter.svelte', line: 5, column: 0 },
        parent: {
          type: 'component', file: 'src/App.svelte', line: 10, column: 4, componentTag: 'Counter',
          parent: { type: 'render', file: 'src/Panel.svelte', line: 6, column: 2,
            parent: { type: 'component', file: 'src/App.svelte', line: 9, column: 2, componentTag: 'Panel', parent: null } },
        },
      },
    })
    expect(api.findTree(button)).toEqual([
      { label: '<button>', source: { file: '/repo/app/src/Counter.svelte', line: 5, column: 1 } },
      { label: 'Counter', source: { file: '/repo/app/src/App.svelte', line: 10, column: 5 } },
      { label: 'Panel', source: { file: '/repo/app/src/App.svelte', line: 9, column: 3 } },
    ])
  })

  it('Vue: the component instances above the element, each with its file', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML = '<button data-claude-source="src/Counter.vue:8:3">b</button>'
    const button = document.querySelector('button') as Element
    const app = { type: { __name: 'App', __file: '/repo/src/App.vue' }, parent: null }
    const panel = { type: { __file: '/repo/src/Panel.vue' }, parent: app }
    Object.defineProperty(button, '__vueParentComponent', { value: { type: { __name: 'Counter', __file: '/repo/src/Counter.vue' }, parent: panel } })
    expect(api.findTree(button).map((item) => `${item.label} ${item.source?.file}:${item.source?.line}`)).toEqual([
      '<button> src/Counter.vue:8',
      'Counter /repo/src/Counter.vue:1',
      'Panel /repo/src/Panel.vue:1',
      'App /repo/src/App.vue:1',
    ])
  })

  it('anything else: each file the elements above come from, the element\'s own first', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML =
      '<main data-claude-source="src/App.jsx:6:5"><section data-claude-source="src/Panel.jsx:2:10">' +
      '<button data-claude-source="src/Counter.jsx:6:5">b</button></section></main>'
    expect(api.findTree(document.querySelector('button') as Element).map((item) => item.label)).toEqual([
      '<button>',
      'Counter',
      'Panel',
      'App',
    ])
  })
})

describe('findTree across frameworks', () => {
  it('adds the files around a React island (an Astro page) after the React components', () => {
    api = startClaudeLocator(options)
    document.body.innerHTML =
      '<main data-claude-source="src/pages/index.astro:9:5"><section data-claude-source="src/components/Panel.astro:1:1">' +
      '<button data-claude-source="src/components/Counter.jsx:6:5">b</button></section></main>'
    const button = document.querySelector('button') as Element
    attachFiber(button, { type: 'button', return: { type: component('Counter', 'src/components/Counter.jsx:3:1'), return: null } })
    expect(api.findTree(button).map((item) => item.label)).toEqual(['<button>', 'Counter', 'Panel', 'index'])
  })
})

describe('Angular', () => {
  afterEach(() => {
    delete (window as unknown as { ng?: unknown }).ng
  })

  it('opens the component that owns the element, and lists component hosts above it', () => {
    const component = (className: string, filePath: string, lineNumber: number) => {
      const ctor = { name: `_${className}`, ɵcmp: { debugInfo: { className, filePath, lineNumber } } }
      return { constructor: ctor }
    }
    document.body.innerHTML = '<app-root><main><app-panel><section><app-counter><button>b</button></app-counter></section></app-panel></main></app-root>'
    const hosts = new Map<Element, unknown>([
      [document.querySelector('app-counter')!, component('Counter', 'src/app/counter.ts', 7)],
      [document.querySelector('app-panel')!, component('Panel', 'src/app/panel.ts', 7)],
      [document.querySelector('app-root')!, component('App', 'src/app/app.ts', 18)],
    ])
    ;(window as unknown as { ng: unknown }).ng = {
      getComponent: (element: Element) => hosts.get(element) ?? null,
      getOwningComponent: () => hosts.get(document.querySelector('app-counter')!),
    }
    api = startClaudeLocator(options)
    const button = document.querySelector('button') as Element
    expect(api.findSource(button)).toEqual({ file: 'src/app/counter.ts', line: 7 })
    expect(api.findTree(button).map((item) => `${item.label} ${item.source?.file}:${item.source?.line}`)).toEqual([
      '<button> src/app/counter.ts:7',
      'Counter src/app/counter.ts:7',
      'Panel src/app/panel.ts:7',
      'App src/app/app.ts:18',
    ])
  })
})

describe('page integration', () => {
  it('opens URL targets in the click and tells the page what was opened', async () => {
    const openWindow = vi.fn()
    vi.stubGlobal('open', openWindow)
    const seen: unknown[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent).detail)
    window.addEventListener('claude-locator:open', listener)
    api = startClaudeLocator({ ...options, endpoint: null, openUrls: ['https://github.com/o/r/blob/main/{path}#L{line}'] })
    document.body.innerHTML = '<i data-claude-source="src/App.tsx:4:5">i</i>'
    ;(document.querySelector('i') as Element).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    expect(openWindow).toHaveBeenCalledWith('https://github.com/o/r/blob/main/src/App.tsx#L4', '_blank', 'noopener')
    expect(seen).toEqual([{ file: 'src/App.tsx', line: 4, column: 5 }])
    window.removeEventListener('claude-locator:open', listener)
  })
})
