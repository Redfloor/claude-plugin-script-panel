import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'scripts-panel',
  component: 'Pane',
  requestId: 'scripts',
  surface: 'desktop',
  props: {
    title: 'Scripts',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

const REPLY = [
  'Run this:',
  '```bash',
  'powershell -ExecutionPolicy Bypass -File scripts\\start_server.ps1',
  '```',
  'then',
  '```bash',
  '.venv\\Scripts\\python scripts\\logger.py',
  '```',
].join('\n')

test('commands from chat are listed newest first, pinned on top', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'scripts' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__scripts-panel__scripts' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'session-a' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: REPLY, toolUses: [] }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  const names = async () =>
    (await ui.findAll({ type: 'Button' }))
      .map(one => one.key ?? '')
      .filter(key => key.startsWith('name-'))
  expect((await ui.find({ type: 'Text', text: /^logger$/ }))?.text).toBe('logger')
  expect((await ui.find({ type: 'Text', text: /^start_server$/ }))?.text).toBe('start_server')

  const before = await names()
  expect(before.length).toBe(2)
  // newest (logger, given second) on top; pin the older one and it moves up
  const last = before[1] ?? ''
  await ui.press({ key: last.replace('name-', 'pin-') })
  const after = await names()
  expect(after[0]).toBe(last)
  // A pin on each of the two rows.
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)

  // The pencil opens a field; Enter saves, and a blank name changes nothing.
  const id = last.replace('name-', '')
  await ui.press({ key: `edit-${id}` })
  await ui.input({ key: `rename-${id}`, text: '   ' })
  expect(await ui.find({ key: `rename-${id}` })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^start_server$/ }))?.text).toBe('start_server')
  await ui.press({ key: `edit-${id}` })
  await ui.input({ key: `rename-${id}`, text: 'train run' })
  expect((await ui.find({ type: 'Text', text: /^train-run$/ }))?.text).toBe('train-run')
  // Cancel closes the field and keeps the name.
  await ui.press({ key: `edit-${id}` })
  await ui.press({ key: `rename-cancel-${id}` })
  expect(await ui.find({ key: `rename-${id}` })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^train-run$/ }))?.text).toBe('train-run')
  await ui.unmount()

  // The terminal has no Svg: the pin falls back to a glyph, and still draws.
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ key: last.replace('name-', 'pin-') })).toBeDefined()
  await terminal.unmount()

  const { text } = await $.command.run({ command: 'scripts', args: 'rename logger log', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(text).toContain('Renamed logger to log')
})

test('the toggle narrows to this session; the widget draws the full rows', async ($, on) => {
  // A script stored by 0.1 (no sessions) and one this session's chat gives.
  mock.store(on, {
    'list:c:\\proj': [
      { id: 'old', name: 'old-tool', command: 'python old.py', cwd: 'C:\\proj', createdAt: 1, isPinned: false },
    ],
  })
  on('command.register', () => ({ value: { command: 'scripts' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__scripts-panel__scripts' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.id', () => ({ value: 'session-a' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: REPLY, toolUses: [] }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:\\proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(PANE)
  const rows = async () => (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('name-')).length
  expect(await rows()).toBe(3)
  await ui.press({ key: 'mode-toggle' })
  expect(await rows()).toBe(2)
  expect(await ui.find({ type: 'Text', text: /This session · 2 of 3/ })).toBeDefined()
  await ui.press({ key: 'mode-toggle' })
  expect(await rows()).toBe(3)
  await ui.unmount()

  const widget = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget', anchoredEdges: [] } })
  // The widget draws the full rows: the toggle, then name, pencil, Run, Copy and Pin on each.
  const keys = (await widget.findAll({ type: 'Button' })).map(one => one.key ?? '')
  expect(keys[0]).toBe('mode-toggle')
  for (const prefix of ['name-', 'edit-', 'run-', 'copy-', 'pin-']) {
    expect(keys.filter(key => key.startsWith(prefix))).toHaveLength(3)
  }
  await widget.press({ key: 'pin-old' })
  const names = (await widget.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('name-'))
  expect(names[0]).toBe('name-old')
  await widget.unmount()
})

test('the pane opens only once there is a script to show', async ($, on) => {
  mock.store(on)
  let opens = 0
  let messages: { role: 'assistant'; text: string; toolUses: never[] }[] = []
  on('command.register', () => ({ value: { command: 'scripts' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__scripts-panel__scripts' } }))
  on('ui.open', () => {
    opens++
    return { value: { isPlaced: true } }
  })
  on('session.id', () => ({ value: 'session-a' }))
  on('session.messages', () => ({ value: messages }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: 'C:\empty', surface: 'desktop', isInteractive: true })
  expect(opens).toBe(0)

  messages = [{ role: 'assistant', text: REPLY, toolUses: [] }]
  await $.turn.complete(TURN)
  expect(opens).toBe(1)
  // Opened once: a later turn leaves a pane the person may have closed alone.
  await $.turn.complete(TURN)
  expect(opens).toBe(1)
})
