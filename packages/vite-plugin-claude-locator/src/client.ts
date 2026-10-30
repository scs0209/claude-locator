/**
 * Runs in the page. Inlined into index.html with Function#toString, so it must stay self-contained:
 * no imports, no references to anything outside its own body.
 */

export interface ClientOptions {
  /** URL of the dev-server endpoint, e.g. `/__claude-open`; null when every target is in the page (the clipboard). */
  endpoint: string | null
  /** Template the location is copied with, e.g. `{path}:{line}`; null to copy nothing. */
  copyFormat: string | null
  /** URL templates the page opens on each click, e.g. `vscode://file/{absolutePath}:{line}`. */
  openUrls?: string[]
  /** The workspace root, for `{path}` in `copyFormat`. */
  workspaceRoot: string
  /** Vite's project root: Svelte records paths relative to it. */
  projectRoot: string
  /** The modifier held while hovering and clicking. */
  modifier: 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  /** The attribute the JSX transform adds, e.g. `data-claude-source`. */
  attribute: string
  /** The property the JSX transform sets on components, e.g. `__claudeSource`. */
  componentProperty: string
}

export interface Source {
  file: string
  line?: number
  column?: number
}

/** One row of the component tree: the clicked element first, then each component above it. */
export interface TreeItem {
  /** `<button>` for the element, the component's name otherwise. */
  label: string
  /** Where it is written, when that is a file of the project. */
  source?: Source
}

export interface ClientApi {
  /** The source location the plugin opens for this element, if any. */
  findSource: (element: Element) => Source | undefined
  /** The element and the components that rendered it, innermost first. */
  findTree: (element: Element) => TreeItem[]
  /** Copies the location if asked to, and sends it to the dev server; resolves to whether that all worked. */
  open: (source: Source) => Promise<boolean>
  /** Removes listeners and the overlay. */
  dispose: () => void
}

export function startClaudeLocator(options: ClientOptions): ClientApi {
  type DebugSource = { fileName?: string; lineNumber?: number; columnNumber?: number }
  type ComponentType = {
    displayName?: string
    name?: string
    render?: ComponentType
    type?: ComponentType
    [key: string]: unknown
  }
  type Fiber = {
    type?: unknown
    elementType?: unknown
    _debugSource?: DebugSource | null
    _debugOwner?: Fiber | null
    return?: Fiber | null
  }
  // What Svelte's dev mode keeps on each element: where it is written, and the component usages above it
  type SvelteParent = { type?: string; file?: string; line?: number; column?: number; componentTag?: string; parent?: SvelteParent | null }
  type SvelteMeta = { loc?: { file?: string; line?: number; column?: number }; parent?: SvelteParent | null }
  // What Vue keeps on each element in dev: the component instance that rendered it
  type VueInstance = { type?: { __name?: string; name?: string; __file?: string }; parent?: VueInstance | null }
  // Angular's dev-mode globals, and what it records on each component class
  type AngularDebugInfo = { className?: string; filePath?: string; lineNumber?: number }
  type AngularComponent = { constructor: { name?: string; ɵcmp?: { debugInfo?: AngularDebugInfo } } }
  type AngularGlobals = {
    getComponent?: (element: Element) => AngularComponent | null
    getOwningComponent?: (element: Element) => AngularComponent | null
  }

  const globalWindow = window as unknown as { __claudeLocator?: ClientApi }
  if (globalWindow.__claudeLocator) {
    globalWindow.__claudeLocator.dispose()
  }

  const isProjectFile = (file: string): boolean => !/[\\/]node_modules[\\/]/.test(file)

  const parsePosition = (value: string): Source => {
    const match = /^(.*):(\d+):(\d+)$/.exec(value)
    return match ? { file: match[1], line: Number(match[2]), column: Number(match[3]) } : { file: value }
  }

  const fromDebugSource = (debugSource: DebugSource | null | undefined): Source | undefined =>
    debugSource && debugSource.fileName && isProjectFile(debugSource.fileName)
      ? { file: debugSource.fileName, line: debugSource.lineNumber, column: debugSource.columnNumber }
      : undefined

  const fiberOf = (element: Element): Fiber | undefined => {
    const key = Object.keys(element).find(
      (name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'),
    )
    return key ? (element as unknown as Record<string, Fiber | undefined>)[key] : undefined
  }

  // React 18 and older, without the attribute: each fiber knows where its JSX element was written.
  // Walking `_debugOwner` from a library's element reaches the component in your code that rendered it.
  const sourceFromFiber = (element: Element): Source | undefined => {
    let fiber = fiberOf(element) || null
    for (let depth = 0; fiber && depth < 200; depth += 1) {
      const source = fromDebugSource(fiber._debugSource)
      if (source) {
        return source
      }
      fiber = fiber._debugOwner || null
    }
    return undefined
  }

  // The attribute the transform added (JSX, Vue and Astro templates): React 19 has no `_debugSource`
  const sourceFromAttribute = (element: Element): Source | undefined => {
    const value = element.getAttribute(options.attribute)
    return value ? parsePosition(value) : undefined
  }

  // Svelte writes paths relative to the Vite project root, and 0-based columns
  const fromProjectPath = (file: string): string =>
    /^([\\/]|[A-Za-z]:)/.test(file) ? file : `${options.projectRoot.replace(/[\\/]+$/, '')}/${file}`

  const svelteMetaOf = (element: Element): SvelteMeta | undefined =>
    (element as unknown as { __svelte_meta?: SvelteMeta }).__svelte_meta

  const sourceFromSvelte = (element: Element): Source | undefined => {
    const loc = svelteMetaOf(element)?.loc
    return loc && loc.file && isProjectFile(loc.file)
      ? { file: fromProjectPath(loc.file), line: loc.line, column: loc.column === undefined ? undefined : loc.column + 1 }
      : undefined
  }

  const angular = (): AngularGlobals | undefined => (window as unknown as { ng?: AngularGlobals }).ng

  const angularInfo = (component: AngularComponent | null | undefined): { name: string; source?: Source } | undefined => {
    if (!component) {
      return undefined
    }
    const info = component.constructor.ɵcmp?.debugInfo
    const name = info?.className || component.constructor.name?.replace(/^_/, '')
    const source = info?.filePath && isProjectFile(info.filePath) ? { file: info.filePath, line: info.lineNumber } : undefined
    return name ? { name, source } : undefined
  }

  // Angular has no position for template elements: the component that owns the element, where its class is
  const sourceFromAngular = (element: Element): Source | undefined => {
    const owning = angular()?.getOwningComponent
    return owning ? angularInfo(owning(element))?.source : undefined
  }

  // The attribute and Svelte's own record come first: they are taken from the file as written, while
  // `_debugSource` is computed after other transforms ran (@vitejs/plugin-react 4 prepends React Refresh code)
  const findSource = (start: Element): Source | undefined => {
    for (let element: Element | null = start; element; element = element.parentElement) {
      const source = sourceFromAttribute(element) || sourceFromSvelte(element)
      if (source) {
        return source
      }
    }
    for (let element: Element | null = start; element; element = element.parentElement) {
      const source = sourceFromFiber(element)
      if (source) {
        return source
      }
    }
    return sourceFromAngular(start)
  }

  // A component fiber's type is its function or class, or the object `memo` / `forwardRef` returned
  const asComponent = (value: unknown): ComponentType | undefined =>
    typeof value === 'function' || (value && typeof value === 'object' && ('render' in value || 'type' in value))
      ? (value as ComponentType)
      : undefined

  const componentName = (type: ComponentType | undefined, depth = 0): string | undefined => {
    if (!type || depth > 3) {
      return undefined
    }
    return type.displayName || type.name || componentName(type.render, depth + 1) || componentName(type.type, depth + 1)
  }

  // What the transform recorded on the component: its declared name and where it is defined
  const componentTag = (fiber: Fiber): { name: string; source: string } | undefined => {
    for (const candidate of [fiber.type, fiber.elementType].map(asComponent)) {
      for (const type of [candidate, candidate?.render, candidate?.type]) {
        const value = type && (type[options.componentProperty] as { name?: unknown; source?: unknown } | undefined)
        if (value && typeof value.name === 'string' && typeof value.source === 'string') {
          return { name: value.name, source: value.source }
        }
      }
    }
    return undefined
  }

  const baseName = (file: string): string => (file.split(/[\\/]/).pop() || file).replace(/\.[^.]+$/, '')

  // Pushes a row unless it repeats the last one (`memo(Card)` puts two fibers for the same component in a row)
  const pushItem = (items: TreeItem[], item: TreeItem): void => {
    const last = items[items.length - 1]
    const isRepeat =
      last.label === item.label && last.source?.file === item.source?.file && last.source?.line === item.source?.line
    if (!isRepeat && items.length < 40) {
      items.push(item)
    }
  }

  // React: the fiber's `return` chain, each component with where the transform recorded it is defined
  const reactTree = (start: Element, items: TreeItem[]): boolean => {
    let fiber = fiberOf(start)?.return || null
    if (!fiber) {
      return false
    }
    for (let depth = 0; fiber && depth < 500; depth += 1) {
      const tag = componentTag(fiber)
      const name = tag ? tag.name : componentName(asComponent(fiber.type))
      if (name) {
        // Without the transform (React 18): where the component was used, not where it is defined
        pushItem(items, { label: name, source: tag ? parsePosition(tag.source) : fromDebugSource(fiber._debugSource) })
      }
      fiber = fiber.return || null
    }
    return true
  }

  // Svelte 5: each component above the element, with where it is used
  const svelteTree = (start: Element, items: TreeItem[]): boolean => {
    let element: Element | null = start
    while (element && !svelteMetaOf(element)) {
      element = element.parentElement
    }
    const meta = element && svelteMetaOf(element)
    if (!meta) {
      return false
    }
    for (let parent = meta.parent || null, depth = 0; parent && depth < 100; parent = parent.parent || null, depth += 1) {
      if (parent.type === 'component' && parent.file) {
        const source = isProjectFile(parent.file)
          ? { file: fromProjectPath(parent.file), line: parent.line, column: (parent.column ?? 0) + 1 }
          : undefined
        pushItem(items, { label: parent.componentTag || baseName(parent.file), source })
      }
    }
    return true
  }

  // Vue: the component instances above the element, each with its file
  const vueTree = (start: Element, items: TreeItem[]): boolean => {
    let element: Element | null = start
    let instance: VueInstance | undefined
    for (; element && !instance; element = element.parentElement) {
      instance = (element as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent
    }
    if (!instance) {
      return false
    }
    for (let current: VueInstance | null = instance, depth = 0; current && depth < 100; current = current.parent || null, depth += 1) {
      const file = current.type?.__file
      const name = current.type?.__name || current.type?.name || (file ? baseName(file) : undefined)
      if (name) {
        pushItem(items, { label: name, source: file && isProjectFile(file) ? { file, line: 1, column: 1 } : undefined })
      }
    }
    return true
  }

  // Angular: each component host element above, with where its class is
  const angularTree = (start: Element, items: TreeItem[]): boolean => {
    const getComponent = angular()?.getComponent
    if (!getComponent) {
      return false
    }
    let found = false
    for (let element: Element | null = start; element; element = element.parentElement) {
      const info = angularInfo(getComponent(element))
      if (info) {
        pushItem(items, { label: info.name, source: info.source })
        found = true
      }
    }
    return found
  }

  // Each file the elements above come from, innermost first: the whole tree for Solid, Preact or Astro, and what
  // lies outside a framework's own tree (an Astro page around a React island). Files already listed are skipped.
  const fileTree = (start: Element, items: TreeItem[]): void => {
    const isListed = (file: string): boolean => items.slice(1).some((item) => item.source && sameFile(item.source.file, file))
    let currentFile: string | undefined
    for (let element: Element | null = start; element; element = element.parentElement) {
      const source = sourceFromAttribute(element)
      if (source && source.file !== currentFile) {
        currentFile = source.file
        if (!isListed(source.file)) {
          pushItem(items, { label: baseName(source.file), source })
        }
      }
    }
  }

  // The attribute's paths are workspace-relative, the frameworks' often absolute
  const sameFile = (a: string, b: string): boolean => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)

  const findTree = (start: Element): TreeItem[] => {
    const items: TreeItem[] = [{ label: `<${start.tagName.toLowerCase()}>`, source: findSource(start) }]
    if (!reactTree(start, items) && !svelteTree(start, items) && !vueTree(start, items)) {
      angularTree(start, items)
    }
    fileTree(start, items)
    return items
  }

  const shortName = (source: Source): string => {
    const name = source.file.split(/[\\/]/).slice(-2).join('/')
    return source.line ? `${name}:${source.line}` : name
  }

  const font = 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;'
  const accent = '#d97757'
  const muted = '#6b6560'

  // Overlay: an outline over the hovered element and a label with its source
  const box = document.createElement('div')
  box.setAttribute('data-claude-locator', '')
  box.style.cssText =
    'position:fixed;z-index:2147483646;pointer-events:none;display:none;box-sizing:border-box;' +
    `border:2px solid ${accent};background:rgba(217,119,87,0.12);border-radius:3px;`
  const label = document.createElement('div')
  label.style.cssText =
    'position:absolute;left:-2px;bottom:100%;margin-bottom:4px;padding:2px 6px;white-space:nowrap;' +
    `${font}color:#fff;background:${accent};border-radius:3px;`
  box.appendChild(label)

  // Tree: the element and the components above it, opened with the modifier and a right-click
  const menu = document.createElement('div')
  menu.setAttribute('data-claude-locator', '')
  menu.setAttribute('role', 'menu')
  menu.style.cssText =
    'position:fixed;z-index:2147483647;display:none;min-width:220px;max-width:min(520px,90vw);max-height:60vh;' +
    'overflow:auto;padding:4px;box-sizing:border-box;background:#1f1e1d;color:#f5f4ef;border-radius:6px;' +
    `box-shadow:0 6px 24px rgba(0,0,0,0.35);${font}`

  let hovered: Element | undefined
  let flashUntil = 0

  const hide = (): void => {
    hovered = undefined
    if (Date.now() >= flashUntil) {
      box.style.display = 'none'
    }
  }

  const mount = (element: HTMLElement): void => {
    if (!element.isConnected) {
      document.documentElement.appendChild(element)
    }
  }

  const show = (element: Element): void => {
    const source = findSource(element)
    hovered = element
    mount(box)
    const rect = element.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = `${rect.left}px`
    box.style.top = `${rect.top}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
    const color = source ? accent : muted
    box.style.borderColor = color
    box.style.background = source ? 'rgba(217,119,87,0.12)' : 'rgba(107,101,96,0.12)'
    label.style.background = color
    if (Date.now() >= flashUntil) {
      if (source) {
        const owner = findTree(element)[1]
        label.textContent = owner ? `${owner.label} · ${shortName(source)}` : shortName(source)
      } else {
        label.textContent = 'no source here'
      }
    }
  }

  const flash = (text: string): void => {
    label.textContent = text
    flashUntil = Date.now() + 1200
    setTimeout(() => {
      // Back to what is under the pointer now, or nothing
      if (hovered) {
        show(hovered)
      } else {
        box.style.display = 'none'
      }
    }, 1200)
  }

  // The same template filling as formatLocation in opencode.ts, which this file cannot import
  const formatLocation = (template: string, source: Source): string => {
    const root = options.workspaceRoot.replace(/[\\/]+$/, '')
    const isAbsolute = /^([\\/]|[A-Za-z]:)/.test(source.file)
    const absolutePath = isAbsolute ? source.file : `${root}/${source.file}`
    const relative = root && isAbsolute && source.file.startsWith(`${root}/`) ? source.file.slice(root.length + 1) : source.file
    return template
      .split('{path}').join(relative)
      .split('{absolutePath}').join(absolutePath)
      .split('{line}').join(String(source.line ?? 1))
      .split('{column}').join(String(source.column ?? 1))
  }

  // In a click handler, while the page may still write to the clipboard; the textarea is for browsers that refuse
  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0;'
      document.body.appendChild(area)
      area.select()
      try {
        return document.execCommand('copy')
      } catch {
        return false
      } finally {
        area.remove()
      }
    }
  }

  const send = async (source: Source): Promise<boolean> => {
    if (!options.endpoint) {
      return true
    }
    const query = new URLSearchParams({ file: source.file })
    if (source.line) {
      query.set('line', String(source.line))
    }
    if (source.column) {
      query.set('column', String(source.column))
    }
    try {
      const response = await fetch(`${options.endpoint}?${query.toString()}`, { method: 'POST' })
      return response.ok
    } catch {
      return false
    }
  }

  // Resolves to [copied: true / false / undefined when not asked, sent]. Called in the click, which lets the page
  // write to the clipboard and open a window
  const copyAndSend = (source: Source): Promise<[boolean | undefined, boolean]> => {
    for (const template of options.openUrls ?? []) {
      window.open(formatLocation(template, source), '_blank', 'noopener')
    }
    // For the page itself: `window.addEventListener('claude-locator:open', (e) => e.detail)`
    window.dispatchEvent(new CustomEvent('claude-locator:open', { detail: source }))
    const copied = options.copyFormat === null ? undefined : copy(formatLocation(options.copyFormat, source))
    return Promise.all([copied, send(source)])
  }

  const open = async (source: Source): Promise<boolean> => {
    const [isCopied, isSent] = await copyAndSend(source)
    return isCopied !== false && isSent
  }

  const openAndFlash = (source: Source): void => {
    const name = shortName(source)
    void copyAndSend(source).then(([isCopied, isSent]) => {
      if (!isSent) {
        flash('Not opened: see the dev server')
      } else if (isCopied === false) {
        flash(options.endpoint || options.openUrls?.length ? `Opened ${name} · copy blocked` : 'Copy blocked by the browser')
      } else {
        const opened = options.endpoint || options.openUrls?.length
        flash(opened ? `Opened ${name}${isCopied ? ' · copied' : ''}` : `Copied ${name}`)
      }
    })
  }

  const closeMenu = (): void => {
    menu.style.display = 'none'
    menu.textContent = ''
  }

  const showMenu = (element: Element, x: number, y: number): void => {
    closeMenu()
    for (const item of findTree(element)) {
      const row = document.createElement('button')
      row.type = 'button'
      row.setAttribute('role', 'menuitem')
      row.disabled = !item.source
      row.style.cssText =
        'display:flex;gap:16px;justify-content:space-between;width:100%;padding:3px 8px;border:0;border-radius:4px;' +
        `background:transparent;text-align:left;${font}color:${item.source ? 'inherit' : '#8a8780'};` +
        `cursor:${item.source ? 'pointer' : 'default'};`
      const name = document.createElement('span')
      name.textContent = item.label
      const where = document.createElement('span')
      where.style.cssText = 'opacity:0.65;white-space:nowrap;'
      where.textContent = item.source ? shortName(item.source) : 'not in project'
      row.append(name, where)
      if (item.source) {
        const source = item.source
        row.addEventListener('mouseenter', () => (row.style.background = 'rgba(217,119,87,0.35)'))
        row.addEventListener('mouseleave', () => (row.style.background = 'transparent'))
        row.addEventListener('click', (event) => {
          event.stopPropagation()
          closeMenu()
          show(element)
          openAndFlash(source)
        })
      }
      menu.appendChild(row)
    }
    mount(menu)
    menu.style.display = 'block'
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`
  }

  const isOwnUi = (target: EventTarget | null): boolean => target instanceof Node && menu.contains(target)

  const onMouseMove = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) {
      return
    }
    if (event[options.modifier] && event.target instanceof Element) {
      show(event.target)
    } else if (hovered) {
      hide()
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.type === 'keydown' && event.key === 'Escape') {
      closeMenu()
    }
    if (event.type === 'keyup' && !event[options.modifier]) {
      hide()
    }
  }

  // Swallow the press so the app does not act on it (and Option+click on a link does not download it)
  const onPress = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) {
      return
    }
    if (menu.style.display !== 'none') {
      closeMenu()
    }
    if (!event[options.modifier] || event.button !== 0 || !(event.target instanceof Element)) {
      return
    }
    const source = findSource(event.target)
    if (!source) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type !== 'click') {
      return
    }
    show(event.target)
    openAndFlash(source)
  }

  const onContextMenu = (event: MouseEvent): void => {
    if (!event[options.modifier] || !(event.target instanceof Element) || isOwnUi(event.target)) {
      return
    }
    if (findTree(event.target).every((item) => !item.source)) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    showMenu(event.target, event.clientX, event.clientY)
  }

  window.addEventListener('mousemove', onMouseMove, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('blur', hide)
  window.addEventListener('mousedown', onPress, true)
  window.addEventListener('pointerdown', onPress, true)
  window.addEventListener('click', onPress, true)
  window.addEventListener('contextmenu', onContextMenu, true)

  const api: ClientApi = {
    findSource,
    findTree,
    open,
    dispose: () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', hide)
      window.removeEventListener('mousedown', onPress, true)
      window.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('click', onPress, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      box.remove()
      menu.remove()
      delete globalWindow.__claudeLocator
    },
  }
  globalWindow.__claudeLocator = api
  return api
}
