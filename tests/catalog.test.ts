import { expect, test } from 'claude-code/testing'

import { entryFromFile, parseRoleFile, parseRoleFlag, rolePrompt, searchRoles, suggestRoles, roleNoteKind, slideFocus, type RoleEntry } from '../hooks/catalog'

const ROLE = `---
name: "Root Cause Debugger"
description: "Diagnose a software failure whose cause is unknown"
category: custom-engineering
---

# Root Cause Debugger

Investigate first.`

const entries: RoleEntry[] = [
  entryFromFile('root-cause-debugger', '/r/custom/root-cause-debugger.md', 'custom', ROLE),
  { id: 'backend-architect', name: 'Backend Architect', description: 'Contracts and reliability', category: 'engineering', path: '/r/a.md' },
  { id: 'ui-designer', name: 'UI Designer', description: 'Interfaces e acessibilidade', category: 'design', path: '/r/b.md' },
]

test('frontmatter: quoted values, category, body without the header', async () => {
  const { meta, body } = parseRoleFile(`\uFEFF${ROLE.replace(/\n/g, '\r\n')}`)
  expect(meta.name).toBe('Root Cause Debugger')
  expect(meta.category).toBe('custom-engineering')
  expect(body.startsWith('# Root Cause Debugger')).toBe(true)
  expect(entries[0]?.category).toBe('custom-engineering')
})

test('a file without frontmatter keeps its id as name and its folder as category', async () => {
  const entry = entryFromFile('plain', '/r/x/plain.md', 'x', 'Just text.')
  expect(entry.name).toBe('plain')
  expect(entry.category).toBe('x')
})

test('search: every word must match, accents ignored, name hits first', async () => {
  expect(searchRoles(entries, 'debug').map(e => e.id)).toEqual(['root-cause-debugger'])
  expect(searchRoles(entries, 'ACESSIBILIDADE').map(e => e.id)).toEqual(['ui-designer'])
  expect(searchRoles(entries, 'architect reliability').map(e => e.id)).toEqual(['backend-architect'])
  expect(searchRoles(entries, 'architect nothing-here')).toEqual([])
  expect(searchRoles(entries, '').length).toBe(3)
})

test('--role flag forms', async () => {
  expect(parseRoleFlag('Do the thing')).toEqual({ kind: 'absent' })
  expect(parseRoleFlag('--role code-reviewer Review it')).toEqual({ kind: 'named', id: 'code-reviewer', rest: 'Review it' })
  expect(parseRoleFlag('  --role=Code-Reviewer -- --role is text here')).toEqual({
    kind: 'named',
    id: 'code-reviewer',
    rest: '--role is text here',
  })
  expect(parseRoleFlag('--role none Review it')).toEqual({ kind: 'clear', rest: 'Review it' })
  expect(parseRoleFlag('--role default\nmulti\nline')).toEqual({ kind: 'clear', rest: 'multi\nline' })
  expect(parseRoleFlag('--role= task').kind).toBe('invalid')
  expect(parseRoleFlag('--role ../etc task').kind).toBe('invalid')
})

test('the prompt names the role and keeps its body', async () => {
  const text = rolePrompt(entries[0]!, 'Investigate first.')
  expect(text.startsWith('Current professional role: Root Cause Debugger (root-cause-debugger)')).toBe(true)
  expect(text.endsWith('Investigate first.')).toBe(true)
})

test('a mistyped id still gets suggestions', async () => {
  expect(suggestRoles(entries, 'root-cause-debuger').map(e => e.id)[0]).toBe('root-cause-debugger')
  expect(suggestRoles(entries, 'zz')).toEqual([])
})

test('what each prompt carries about the role', async () => {
  expect(roleNoteKind(null, null)).toBe('none')
  expect(roleNoteKind('a', null)).toBe('full')
  expect(roleNoteKind('a', 'a')).toBe('reminder')
  expect(roleNoteKind('b', 'a')).toBe('full')
  expect(roleNoteKind(null, 'a')).toBe('cleared')
})

test('the slots stay put and their contents scroll under the ring', async () => {
  // 5 slots over 20 rows: the last slot scrolls down while more lies below.
  expect(slideFocus(4, 0, 5, 20)).toEqual({ start: 1, slot: 3 })
  expect(slideFocus(4, 15, 5, 20)).toEqual({ start: 15, slot: 4 })
  // The first slot scrolls up while more lies above.
  expect(slideFocus(0, 3, 5, 20)).toEqual({ start: 2, slot: 1 })
  expect(slideFocus(0, 0, 5, 20)).toEqual({ start: 0, slot: 0 })
  // Inner slots, and a list shorter than the slots, never scroll.
  expect(slideFocus(2, 7, 5, 20)).toEqual({ start: 7, slot: 2 })
  expect(slideFocus(2, 0, 5, 3)).toEqual({ start: 0, slot: 2 })
})
