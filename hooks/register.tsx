import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ListMode, Script } from '../types'

const PANE = 'scripts'
const TITLE = 'Scripts'
const TOOL = 'scripts'
const FENCE = /```(?:bash|sh|shell|powershell|pwsh|ps1|cmd)[^\S\n]*\n([\s\S]*?)```/g

const scripts = atom({ plugin: 'scripts-panel', key: 'scripts' } as const, [])
const expanded = atom({ plugin: 'scripts-panel', key: 'expanded' } as const, [])
const notice = atom({ plugin: 'scripts-panel', key: 'notice' } as const, '')
const viability = atom({ plugin: 'scripts-panel', key: 'viability' } as const, '')
const editingId = atom({ plugin: 'scripts-panel', key: 'editingId' } as const, '')
const mode = atom({ plugin: 'scripts-panel', key: 'mode' } as const, 'project')

const titleFor = (shown: ListMode) => `${TITLE} · ${shown === 'project' ? 'project' : 'this session'}`

// The mode is kept across sessions: whichever was last chosen is how the pane opens.
async function toggleMode($: Dollar) {
  const { value: current = 'project' } = await $.state.get({ plugin: 'scripts-panel', key: 'mode' })
  const next: ListMode = current === 'project' ? 'session' : 'project'
  await $.store.set('mode', next)
  await $.state.set({ plugin: 'scripts-panel', key: 'mode' }, next)
  await $.ui.open({ id: PANE, title: titleFor(next) })
}

// Set at session.start, which runs again on every reload.
let cwd = ''
let sessionId = ''
// Whether this load has opened the pane unasked: once is enough, so a pane the
// person closed stays closed until /scripts or the next session.
let hasOpened = false

// Opens the pane unasked only once it has something to show in the current mode.
// It starts minimized, as a widget in the session rail where the app allows; the
// person can expand it, and the app keeps where they put it.
async function openIfAny($: Dollar) {
  if (hasOpened) return
  const { value: shown = 'project' } = await $.state.get({ plugin: 'scripts-panel', key: 'mode' })
  const list = await load($)
  const visible = shown === 'project' ? list : list.filter(one => one.sessions?.includes(sessionId))
  if (visible.length === 0) return
  hasOpened = true
  void $.ui.open({ id: PANE, title: titleFor(shown), placement: 'widget' })
}

type Dollar = EngineInterface

const cwdKey = () => cwd.replace(/[\\/]+$/, '').toLowerCase()
const listKey = () => `list:${cwdKey()}`
const removedKey = () => `removed:${cwdKey()}`

const ordered = (list: readonly Script[]) =>
  [...list].sort((a, b) =>
    a.isPinned === b.isPinned ? b.createdAt - a.createdAt : a.isPinned ? -1 : 1,
  )

const cleanName = (name: string) => name.trim().replace(/\s+/g, '-').slice(0, 40)

// How two spellings of one command compare: `.venv/Scripts/python` and
// `.venv\Scripts\python` run the same thing on Windows, as does a run of spaces.
export const commandKey = (command: string) => command.replace(/\//g, '\\').replace(/\s+/g, ' ').trim()

// Names that say nothing on their own, so the folder above is put in front.
const GENERIC_STEMS = new Set(['best', 'latest', 'last', 'final', 'model', 'checkpoint', 'config', 'main'])
const SKIPPED_DIRS = new Set(['checkpoints', 'checkpoint', 'models', 'runs', 'configs'])

// The flag that tells one run of a script or module from another, and the
// short form of its value: `--bot fast` is `fast`,
// `--model runs\exp1\best.zip` is `exp1-best`.
function variantOf(command: string): string | undefined {
  const flag = command.match(/(?:^|\s)--?(?:bot|model|config|mode|task|env|checkpoint)(?:=|\s+)("[^"]+"|'[^']+'|\S+)/i)
  const value = flag?.[1]?.replace(/^["']|["']$/g, '')
  if (!value) return undefined
  const parts = value.split(/[\\/]/).filter(Boolean)
  const stem = (parts.pop() ?? '').replace(/\.[^.]+$/, '')
  if (!GENERIC_STEMS.has(stem.toLowerCase())) return stem
  const parent = [...parts].reverse().find(dir => !SKIPPED_DIRS.has(dir.toLowerCase()))

  return parent ? `${parent}-${stem}` : stem
}

export function shortName(command: string): string {
  const withVariant = (base: string) => {
    const variant = variantOf(command)
    return variant ? `${base}-${variant}` : base
  }
  const file = command.match(/([\w.-]+)\.(?:ps1|py|bat|cmd|sh|js|mjs|ts)\b/i)
  if (file?.[1]) return withVariant(file[1])
  const module = command.match(/\s-m\s+([\w.]+)/)
  if (module?.[1]) return withVariant(module[1])
  const words = command
    .split(/\s+/)
    .filter(word => word && !word.startsWith('-'))
    .map(word => word.split(/[\\/]/).pop() ?? word)

  return words.slice(0, 2).join('-').slice(0, 24) || 'script'
}

function uniqueName(name: string, list: readonly Script[]): string {
  const taken = new Set(list.map(one => one.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let n = 2
  while (taken.has(`${name}-${n}`.toLowerCase())) n++

  return `${name}-${n}`
}

export function commandsIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(FENCE)) {
    const command = (match[1] ?? '').trim()
    if (command) found.push(command)
  }

  return found
}

async function save($: Dollar, list: Script[]) {
  await $.store.set(listKey(), list)
  await $.state.set({ plugin: 'scripts-panel', key: 'scripts' }, list)
}

async function load($: Dollar): Promise<Script[]> {
  return ((await $.store.get(listKey())) as Script[] | undefined) ?? []
}

async function say($: Dollar, text: string) {
  await $.state.set({ plugin: 'scripts-panel', key: 'notice' }, text)
}

const withSession = (script: Script): Script =>
  sessionId === '' || script.sessions?.includes(sessionId)
    ? script
    : { ...script, sessions: [...(script.sessions ?? []), sessionId] }

async function addScript($: Dollar, command: string, name?: string, isPinned = false) {
  const list = await load($)
  const existing = list.find(one => commandKey(one.command) === commandKey(command))
  if (existing) {
    const tagged = withSession(existing)
    if (tagged !== existing) await save($, list.map(one => (one.id === existing.id ? tagged : one)))
    return tagged
  }
  const script: Script = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: uniqueName(cleanName(name ?? shortName(command)), list),
    command,
    cwd,
    createdAt: Date.now(),
    isPinned,
    sessions: sessionId === '' ? [] : [sessionId],
  }
  const removed = ((await $.store.get(removedKey())) as string[] | undefined) ?? []
  await $.store.set(removedKey(), removed.filter(one => commandKey(one) !== commandKey(command)))
  await save($, [...list, script])

  return script
}

async function harvest($: Dollar) {
  const messages = await $.session.messages()
  const list = await load($)
  const removed = new Set((((await $.store.get(removedKey())) as string[] | undefined) ?? []).map(commandKey))
  const known = new Set(list.map(one => commandKey(one.command)))
  const seenHere = new Set<string>()
  const base = Date.now()
  const added: Script[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const command of commandsIn(message.text)) {
      const key = commandKey(command)
      if (removed.has(key)) continue
      seenHere.add(key)
      if (known.has(key)) continue
      known.add(key)
      added.push({
        id: `${base.toString(36)}${added.length}`,
        name: uniqueName(shortName(command), [...list, ...added]),
        command,
        cwd,
        createdAt: base + added.length,
        isPinned: false,
        sessions: [],
      })
    }
  }
  // Tag every script this session's chat holds, ones known from other sessions too.
  const all = [...list, ...added]
  const tagged = all.map(one => (seenHere.has(commandKey(one.command)) ? withSession(one) : one))
  if (added.length > 0 || tagged.some((one, i) => one !== all[i])) await save($, tagged)
  else await $.state.set({ plugin: 'scripts-panel', key: 'scripts' }, list)
}

function find(list: readonly Script[], name: string) {
  const wanted = name.trim().toLowerCase()

  return list.find(one => one.name.toLowerCase() === wanted || one.id === name.trim())
}

async function removeScript($: Dollar, name: string) {
  const list = await load($)
  const script = find(list, name)
  if (!script) return undefined
  const removed = ((await $.store.get(removedKey())) as string[] | undefined) ?? []
  await $.store.set(removedKey(), [...removed, script.command])
  await save($, list.filter(one => one.id !== script.id))

  return script
}

async function renameScript($: Dollar, name: string, newName: string) {
  const list = await load($)
  const script = find(list, name)
  if (!script) return undefined
  const others = list.filter(one => one.id !== script.id)
  const renamed = { ...script, name: uniqueName(cleanName(newName), others) }
  await save($, list.map(one => (one.id === script.id ? renamed : one)))

  return renamed
}

async function pinScript($: Dollar, name: string, isPinned: boolean) {
  const list = await load($)
  const script = find(list, name)
  if (!script) return undefined
  await save($, list.map(one => (one.id === script.id ? { ...one, isPinned } : one)))

  return script
}

function base64Utf16(text: string): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes.push(code & 0xff, code >> 8)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3)
    const n = (a << 16) | (b << 8) | c
    out += abc.charAt((n >> 18) & 63) + abc.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? abc.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? abc.charAt(n & 63) : '='
  }

  return out
}

async function runScript($: Dollar, script: Script) {
  const where = script.cwd || cwd
  // First choice: a tab of the app's own Terminal panel, as a chat Run button does.
  // Why that failed is kept for the notice, so a fallback says what went wrong.
  let why = ''
  try {
    const input = {
      tool: 'mcp__terminal__run_in_terminal',
      command: script.command,
      cwd: where,
      title: script.name,
    } as unknown as Parameters<Dollar['tool']['call']>[0]
    const ran = (await $.tool.call(input)) as { deny?: string; isError?: boolean; text?: string }
    if (!ran.deny && !ran.isError) {
      await say($, `Started ${script.name} in the Terminal panel.`)
      return
    }
    why = ran.deny ?? ran.text ?? 'an error with no text'
  } catch (error) {
    why = error instanceof Error ? error.message : String(error)
  }
  const quoted = where.replace(/'/g, "''")
  await $.process.run([
    'powershell',
    '-NoProfile',
    '-Command',
    `Start-Process powershell -WorkingDirectory '${quoted}' -ArgumentList '-NoExit','-EncodedCommand','${base64Utf16(script.command)}'`,
  ])
  // In auto mode the desktop app refuses a mod's own run_in_terminal ("Have Claude
  // make the call"), so the window is the expected path there and says nothing more;
  // any other refusal is still named, as something new to look into.
  const isAutoModeRefusal = /auto mode/i.test(why)
  await say(
    $,
    isAutoModeRefusal
      ? `Started ${script.name} in a PowerShell window.`
      : `Started ${script.name} in a PowerShell window (Terminal panel: ${why.slice(0, 200)})`,
  )
}

// The name cut to what the row spares beside its arrow and four icons, so a long
// one (a model tag, say) never pushes Run, Copy and Pin out of the row.
function fitName(name: string, bodyColumns: number) {
  const room = Math.max(8, bodyColumns - 14)

  return name.length > room ? `${name.slice(0, room - 1)}…` : name
}

async function copyScript($: Dollar, script: Script, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') {
  const copied = await $.ui.copy({ text: script.command, surface })
  if (!copied.isCopied) await $.process.run(['clip'], { stdin: script.command })
  await say($, `Copied ${script.name}.`)
}

// A Button holds only text, and no font has an outline and filled pin pair, so
// the pane draws this under a blank Button. An Svg is an isolated image: it
// cannot inherit the text colour and a mod cannot read the theme, hence a fixed one.
const PIN_COLOR = '#c9c7bd'
const PIN_HEAD =
  'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'

function pinIcon(isFilled: boolean) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${PIN_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M12 17v5"/><path fill="${isFilled ? PIN_COLOR : 'none'}" d="${PIN_HEAD}"/></svg>`
  )
}

async function setEditing($: Dollar, id: string) {
  await $.state.set({ plugin: 'scripts-panel', key: 'editingId' }, id)
}

async function submitRename($: Dollar, script: Script, value: string) {
  await setEditing($, '')
  // A blank or unchanged name is a cancel.
  if (cleanName(value) === '' || cleanName(value) === script.name) return
  await renameScript($, script.id, value)
}

function listText(list: readonly Script[]) {
  if (list.length === 0) return 'No scripts yet.'

  return ordered(list)
    .map(one => `${one.isPinned ? '📌 ' : ''}${one.name}: ${one.command}`)
    .join('\n')
}

// After a Claude Code update, check (with no model call) whether the engine
// now offers a site in the desktop's session-info column, the place the
// Scripts section was really wanted. Two signals, both plain file and process
// work: the probe folder run through this version's `claude plugin validate`,
// and, once any session has loaded the plugin-authoring skill on this
// version, its types file diffed against what 2.1.325 had. (2.1.325 added the
// `widget` placement, a pane minimized into the session rail but glance-only:
// what this watches for now is a seat there that takes clicks.)
const KNOWN_COMPONENTS = [
  'AskUserQuestion', 'UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup',
  'CommandOutput', 'ToolProgress', 'Spinner', 'TurnDuration', 'InfoNotice', 'SessionMode',
  'PromptHint', 'AbovePrompt', 'AbovePromptList', 'Pane', 'Placed', 'Backdrop',
]
const KNOWN_PANE_ARGS = [
  'id', 'title', 'focus', 'closeOnEscape', 'holdToasts', 'backgroundColor', 'rows', 'columns', 'placement',
]

function blockOf(text: string, opener: string): string {
  const start = text.indexOf(opener)
  if (start < 0) return ''
  const end = text.indexOf('\n  };', start)

  return text.slice(start, end < 0 ? undefined : end)
}

async function typesFindings($: Dollar, version: string): Promise<string[] | undefined> {
  const temp = (await $.env.get('TEMP')) ?? ''
  const root = `${temp}\\claude\\bundled-skills\\${version}`
  if (!(await $.fs.exists(root))) return undefined
  for (const entry of await $.fs.list(root)) {
    const file = `${root}\\${entry.name}\\plugin-authoring\\types\\claude-code.d.ts`
    if (entry.kind !== 'dir' || !(await $.fs.exists(file))) continue
    const text = String(await $.fs.read(file))
    const components = [...blockOf(text, 'export type RenderPropsOf = {').matchAll(/^ {6}([A-Z]\w+): \{$/gm)]
      .map(match => match[1] ?? '')
      .filter(name => !KNOWN_COMPONENTS.includes(name))
    const paneArgs = [...blockOf(text, 'export type PaneOpenArgs = {').matchAll(/^ {6}(\w+)\??:/gm)]
      .map(match => match[1] ?? '')
      .filter(name => !KNOWN_PANE_ARGS.includes(name))

    return [
      ...components.map(name => `new UI site "${name}"`),
      ...paneArgs.map(name => `new pane option "${name}"`),
    ]
  }

  return undefined
}

// Where the desktop app keeps each version's claude.exe: under Roaming before
// late 2026, then under Local\Claude-Data\<install id>.
async function versionRoots($: Dollar, version: string): Promise<string[]> {
  const roaming = (await $.env.get('APPDATA')) ?? ''
  const local = (await $.env.get('LOCALAPPDATA')) ?? ''
  const roots = [`${roaming}\\Claude\\claude-code\\${version}`]
  const data = `${local}\\Claude-Data`
  if (local !== '' && (await $.fs.exists(data))) {
    for (const install of await $.fs.list(data)) {
      if (install.kind === 'dir') roots.push(`${data}\\${install.name}\\claude-code\\${version}`)
    }
  }

  return roots
}

// undefined when this version's claude.exe was not found, so it is tried again.
async function probeFindings($: Dollar, version: string): Promise<string[] | undefined> {
  for (const root of await versionRoots($, version)) {
    if (!(await $.fs.exists(root))) continue
    for (const entry of await $.fs.list(root)) {
      const exe = `${root}\\${entry.name}\\claude.exe`
      if (entry.kind !== 'dir' || !(await $.fs.exists(exe))) continue
    const probe = `${$.plugin.root}\\probe`
    const ran = await $.process.run([exe, 'plugin', 'validate', probe], { timeoutMs: 60_000 })
    const out = ran.stdout + ran.stderr
    const named = [...(await $.fs.read(`${probe}\\hooks\\register.ts`)).matchAll(/component: '(\w+)'/g)]
      .map(match => match[1] ?? '')
      if (!out.includes('no component is named')) return []

      return named.filter(name => !out.includes(`{component=${name}}: no component is named`)).map(name => `UI site "${name}" now exists`)
    }
  }

  return undefined
}

async function checkViability($: Dollar) {
  const { version } = await $.session.version()
  const shown = ((await $.store.get('viability2:found')) as string | undefined) ?? ''
  await $.state.set({ plugin: 'scripts-panel', key: 'viability' }, shown)
  if ((await $.store.get('viability2:typesChecked')) === version) return
  const findings: string[] = []
  if ((await $.store.get('viability2:probed')) !== version) {
    const probed = await probeFindings($, version)
    if (probed) {
      findings.push(...probed)
      await $.store.set('viability2:probed', version)
    }
  }
  const fromTypes = await typesFindings($, version)
  if (fromTypes) {
    findings.push(...fromTypes)
    await $.store.set('viability2:typesChecked', version)
  }
  if (findings.length === 0) return
  const text = `Claude Code ${version}: ${findings.join('; ')}. Ask Claude whether the Scripts widget can take clicks in the session rail now.`
  await $.store.set('viability2:found', text)
  await $.state.set({ plugin: 'scripts-panel', key: 'viability' }, text)
  $.ui.toast(text)
  void $.ui.notify(text, { title: 'Scripts panel' })
}

async function dismissViability($: Dollar) {
  await $.store.set('viability2:found', '')
  await $.state.set({ plugin: 'scripts-panel', key: 'viability' }, '')
}

const HELP = [
  '/scripts                       open the Scripts panel and list scripts',
  '/scripts add <name> <command>  add a script under a shortname',
  '/scripts rm <name>             remove a script',
  '/scripts rename <name> <new>   change a shortname',
  '/scripts pin <name> | unpin <name>',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    await $.command.register({
      name: 'scripts',
      description: 'Scripts panel: open, add, rm, rename, pin, unpin',
      argumentHint: '[add <name> <command> | rm <name> | rename <name> <new> | pin <name> | unpin <name>]',
    })
    await $.tool.register({
      name: TOOL,
      isDeferred: false,
      description:
        "Manage the user's Scripts panel (a quick-launch list of shell commands for this project, " +
        'beside the chat). Use when the user asks to add, remove, rename, pin, unpin or list scripts. ' +
        'Commands you give in fenced bash blocks are added automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'rename', 'pin', 'unpin', 'list'] },
          name: { type: 'string', description: 'The shortname (for add: optional, derived from the command if left out)' },
          command: { type: 'string', description: 'For add: the full one-line command' },
          newName: { type: 'string', description: 'For rename: the new shortname' },
        },
        required: ['action'],
      },
    })
    sessionId = await $.session.id()
    const shown = ((await $.store.get('mode')) as ListMode | undefined) ?? 'project'
    await $.state.set({ plugin: 'scripts-panel', key: 'mode' }, shown)
    await harvest($)
    await openIfAny($)
    void checkViability($).catch(() => undefined)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await harvest($)
      await openIfAny($)
    }

    return done
  })

  on('command.run', { command: 'scripts' }, async ($, e) => {
    const [verb = '', first = '', ...rest] = e.args.trim().split(/\s+/)
    const tail = e.args.trim().split(/\s+/).slice(2).join(' ')
    switch (verb.toLowerCase()) {
      case '':
      case 'list':
      case 'open': {
        await $.ui.open({ id: PANE, title: TITLE })
        return { text: listText(await load($)) }
      }
      case 'add': {
        if (!first || rest.length === 0) return { text: `Usage: /scripts add <name> <command>\n\n${HELP}` }
        const script = await addScript($, tail, first)
        return { text: `Added ${script.name}: ${script.command}` }
      }
      case 'rm':
      case 'remove':
      case 'delete': {
        const script = await removeScript($, first)
        return { text: script ? `Removed ${script.name}.` : `No script named ${first}.` }
      }
      case 'rename': {
        const script = await renameScript($, first, rest[0] ?? '')
        return { text: script ? `Renamed ${first} to ${script.name}.` : `No script named ${first}.` }
      }
      case 'pin':
      case 'unpin': {
        const script = await pinScript($, first, verb.toLowerCase() === 'pin')
        return { text: script ? `${verb === 'pin' ? 'Pinned' : 'Unpinned'} ${script.name}.` : `No script named ${first}.` }
      }
      default:
        return { text: HELP }
    }
  })

  on('tool.call', { tool: 'mcp__scripts-panel__scripts' }, async ($, e) => {
    const input = e as unknown as { action: string; name?: string; command?: string; newName?: string }
    const reply = (text: string) => ({ result: text })
    switch (input.action) {
      case 'add': {
        if (!input.command) return reply('add needs a command.')
        const script = await addScript($, input.command.trim(), input.name)
        return reply(`Added ${script.name}: ${script.command}`)
      }
      case 'remove': {
        const script = await removeScript($, input.name ?? '')
        return reply(script ? `Removed ${script.name}.` : `No script named ${input.name}.`)
      }
      case 'rename': {
        const script = await renameScript($, input.name ?? '', input.newName ?? '')
        return reply(script ? `Renamed ${input.name} to ${script.name}.` : `No script named ${input.name}.`)
      }
      case 'pin':
      case 'unpin': {
        const script = await pinScript($, input.name ?? '', input.action === 'pin')
        return reply(script ? `${input.action === 'pin' ? 'Pinned' : 'Unpinned'} ${script.name}.` : `No script named ${input.name}.`)
      }
      default:
        return reply(listText(await load($)))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Code } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const Input = 'Input' in elements ? elements.Input : undefined
    const editing = await read($, editingId)
    const shown = await read($, mode)
    const all = ordered(await read($, scripts))
    const list = shown === 'project' ? all : all.filter(one => one.sessions?.includes(sessionId))
    const open = new Set(await read($, expanded))
    const said = await read($, notice)
    const found = await read($, viability)
    const toggle = (id: string) => () =>
      update($, expanded, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))
    const scope = shown === 'project' ? `Whole project · ${list.length}` : `This session · ${list.length} of ${all.length}`

    // The widget seat (the session rail, or a corner of the chat) draws the same
    // tree as the full pane: the API says clicks "may not reach" a widget, but on
    // the desktop app (2.1.325) they do, tried on 2026-11-16.

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexGrow={1}>
            <Text dimColor size="caption">{scope}</Text>
          </Box>
          <Button
            key="mode-toggle"
            plain
            dimColor
            label={shown === 'project' ? '⊖' : '⊕'}
            onPress={() => toggleMode($)}
          />
        </Box>
        {found !== '' && (
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Text color="suggestion">{found}</Text>
            <Button key="viability-dismiss" plain dimColor label="✕" onPress={() => dismissViability($)} />
          </Box>
        )}
        {list.length === 0 && (
          <Text dimColor>
            {shown === 'project'
              ? 'No scripts yet. Commands Claude gives you in bash blocks land here, or use /scripts add.'
              : 'No scripts from this session yet. ⊕ shows the whole project.'}
          </Text>
        )}
        {list.map(script => {
          const isOpen = open.has(script.id)
          return (
            <Box flexDirection="column" key={`row-${script.id}`}>
              <Box flexDirection="row" columnGap={1} alignItems="center">
                {/* Arrays, not fragments: the desktop draws a fragment as a block of its own, stacking its children. */}
                {Input && editing === script.id
                  ? [
                      <Box flexGrow={1} flexShrink={1}>
                        <Input
                          key={`rename-${script.id}`}
                          value={script.name}
                          placeholder="Script name"
                          submitLabel="save"
                          autoFocus
                          onSubmit={value => submitRename($, script, value)}
                        />
                      </Box>,
                      <Button key={`rename-cancel-${script.id}`} plain dimColor label="✕" onPress={() => setEditing($, '')} />,
                    ]
                  : [
                      <Box flexShrink={1}>
                        <Button key={`name-${script.id}`} plain onPress={toggle(script.id)}>
                          <Text dimColor>{isOpen ? '▾' : '▸'}</Text> <Text mono color="claude">{fitName(script.name, e.props.bodyColumns)}</Text>
                        </Button>
                      </Box>,
                      Input && <Button key={`edit-${script.id}`} plain dimColor label="✎" onPress={() => setEditing($, script.id)} />,
                      <Box flexGrow={1} />,
                    ]}
                <Button key={`run-${script.id}`} plain label="▶" onPress={() => runScript($, script)} />
                <Button key={`copy-${script.id}`} plain dimColor label="⧉" onPress={press => copyScript($, script, press.surface)} />
                {Svg ? (
                  <Box position="relative">
                    <Svg source={pinIcon(script.isPinned)} alt={script.isPinned ? 'Pinned' : 'Not pinned'} width={15} height={15} />
                    <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                      {/* No label: the desktop draws a label over the blank child, on top of the icon. */}
                      <Button key={`pin-${script.id}`} plain onPress={() => pinScript($, script.id, !script.isPinned)}>
                        {' '}
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Button
                    key={`pin-${script.id}`}
                    plain
                    dimColor={!script.isPinned}
                    label={script.isPinned ? '◆' : '◇'}
                    onPress={() => pinScript($, script.id, !script.isPinned)}
                  />
                )}
              </Box>
              {isOpen && <Code source={script.command} language="powershell" wrap="wrap" />}
            </Box>
          )
        })}
        {said !== '' && <Text dimColor size="caption">{said}</Text>}
      </Box>
    )
  })
}
