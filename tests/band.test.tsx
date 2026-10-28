import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'roles',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

// One role, code-reviewer, under ~/.pi/agent/roles/eng, and a band drawn beneath
// the plugin's (another plugin's, or the engine's).
function setup(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? '/home' : undefined }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.list', (_, e) => {
    if (plain(e.path) === '/home/.pi/agent/roles') return { value: [{ name: 'eng', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (plain(e.path) === '/home/.pi/agent/roles/eng') {
      return { value: [{ name: 'code-reviewer.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
    }

    return { value: [] }
  })
  on('fs.read', () => ({ value: '---\nname: "Code Reviewer"\ndescription: "Reviews code"\n---\n\nBody.' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', children: ['beneath'] }))
}

test('after /role the band shows the role in its colours, over what is beneath', async ($, on) => {
  setup(on)
  await $.command.run({ command: 'role', args: 'code-reviewer' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const badge = await ui.find({ type: 'Text', text: /Role: Code Reviewer/ })
  expect(badge?.text?.trim()).toBe('Role: Code Reviewer')
  expect(badge?.props.color).toBe('#6ee7dc')
  expect(badge?.props.backgroundColor).toBe('#29213d')
  expect((await ui.find({ type: 'Text', text: /^beneath$/ }))?.text).toBe('beneath')
  await ui.unmount()
})

test('on default the band shows no role', async ($, on) => {
  setup(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Role:/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^beneath$/ }))?.text).toBe('beneath')
  await ui.unmount()
})

test('a survey keeps the band', async ($, on) => {
  setup(on)
  await $.command.run({ command: 'role', args: 'code-reviewer' })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Role:/ })).toBeUndefined()
  await ui.unmount()
})
