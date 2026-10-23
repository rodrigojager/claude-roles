import { expect, test } from 'claude-code/testing'

const PICKER = {
  plugin: 'roles',
  component: 'Pane',
  requestId: 'role-picker',
  props: {
    title: 'Role',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ids = Array.from({ length: 30 }, (_, i) => `role-${String(i + 1).padStart(2, '0')}`)

// Thirty roles under ~/.pi/agent/roles/eng; every other folder is empty.
// The engine hands paths on in this machine's spelling (C:\home\...).
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function catalog(on: Parameters<Parameters<typeof test>[1]>[1], stored: unknown[] = [], closed: unknown[] = []) {
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? '/home' : undefined }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.list', (_, e) => {
    if (plain(e.path) === '/home/.pi/agent/roles') return { value: [{ name: 'eng', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (plain(e.path) === '/home/.pi/agent/roles/eng') {
      return { value: ids.map(id => ({ name: `${id}.md`, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
    }

    return { value: [] }
  })
  on('fs.read', (_, e) => {
    const id = plain(e.path).split('/').pop()!.replace('.md', '')

    return { value: `---\nname: "${id.replace('role', 'Role')}"\ndescription: "Does ${id} things"\n---\n\nBody of ${id}.` }
  })
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    stored.push(e)

    return { value: undefined }
  })
  on('ui.focus', () => ({}))
  on('ui.close', (_, e) => {
    closed.push(e)

    return { value: undefined }
  })
}

test('the picker draws only the cards that fit, each with its description', async ($, on) => {
  catalog(on)
  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })

  // 20 rows: search, hint, blank, then 3 rows a card -> 6 cards, default first.
  const cards = await ui.findAll({ type: 'Button' })
  expect(cards).toHaveLength(6)
  expect(cards.map(card => card.key)).toEqual(['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'])
  expect((await ui.find({ type: 'Text', text: /^default$/ }))?.text).toBe('default')
  expect((await ui.find({ type: 'Text', text: /^Role-01$/ }))?.text).toBe('Role-01')
  expect((await ui.find({ type: 'Text', text: /Does role-01 things/ }))?.text?.trim()).toBe('Does role-01 things')
  await ui.unmount()
})

test('typing filters and starts the window over', async ($, on) => {
  catalog(on)
  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })

  await ui.input({ key: 'q', text: 'role-2', kind: 'change' })
  const names = (await ui.findAll({ type: 'Text', text: /^Role-/ })).map(row => row.text)
  expect(names.length).toBeGreaterThan(0)
  expect(names.every(name => name?.startsWith('Role-2'))).toBe(true)
  await ui.unmount()
})

test('Enter in an empty search closes without picking; with a search it picks the top match', async ($, on) => {
  // Activating a role stores it per session: that write is what a pick leaves.
  const stored: unknown[] = []
  const closed: unknown[] = []
  catalog(on, stored, closed)
  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })

  await ui.input({ key: 'q', text: '' })
  expect(stored).toEqual([])
  expect(closed).toHaveLength(1)

  await ui.input({ key: 'q', text: 'role-07', kind: 'change' })
  await ui.input({ key: 'q', text: 'role-07' })
  expect(JSON.stringify(stored)).toContain('role-07')
  await ui.unmount()
})

test('a slot picks the role it shows', async ($, on) => {
  const stored: unknown[] = []
  catalog(on, stored)
  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })

  await ui.press({ key: 'slot-3' })
  expect(JSON.stringify(stored)).toContain('role-03')
  await ui.unmount()
})

test('the focused card is padded across the whole body, pre-inverted', async ($, on) => {
  // The slot the ring is on, as the ui.focus hook records it.
  on('state.get', (_, e, next) => (e.key === 'focusedSlot' ? { value: { value: 2, version: 1 } } : next(e)))
  catalog(on)
  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })

  // bodyColumns 60: each row of the focused card runs 59 columns.
  const focusedLine = await ui.find({ type: 'Text', text: /Does role-02 things/ })
  expect(focusedLine?.text?.length).toBe(59)
  const restLine = await ui.find({ type: 'Text', text: /Does role-03 things/ })
  expect(restLine?.text?.trim()).toBe('Does role-03 things')
  await ui.unmount()
})
