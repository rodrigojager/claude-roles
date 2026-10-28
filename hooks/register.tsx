import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ActiveRole } from '../types'
import {
  CLEARED_NOTE,
  DELEGATION_HINT,
  entryFromFile,
  fullNote,
  isValidRoleId,
  parseRoleFile,
  parseRoleFlag,
  rolePrompt,
  reminderNote,
  roleNoteKind,
  searchRoles,
  suggestRoles,
  slideFocus,
  type RoleEntry,
} from './catalog'

// The active role of this session; `null` is Pi's "default" (no role).
const active = atom({ plugin: 'roles', key: 'active' } as const, null, { shape: 'active-1' })
// The picker's search text.
const query = atom({ plugin: 'roles', key: 'query' } as const, '')

const PICKER = 'role-picker'
const VIEWER = 'role-viewer'
const announced = atom({ plugin: 'roles', key: 'announced' } as const, null)
const hinted = atom({ plugin: 'roles', key: 'hinted' } as const, false)
// The first picker row drawn.
const windowAt = atom({ plugin: 'roles', key: 'windowAt' } as const, 0)
// The picker slot holding the focus ring; -1 when the search box (or nothing) has it.
const focusedSlot = atom({ plugin: 'roles', key: 'focusedSlot' } as const, -1)
const TOOL = 'roles'
// Padding that layout keeps (plain spaces at a row's edges are trimmed).
const NBSP = '\u00a0'
// The text colour, before the focus inverts it, of a focused card's category and description.
const MUTED_INK = '#6b7280'
// The active role's badge, as pi-goal-highlight draws it.
const ROLE_INK = '#6ee7dc'
const ROLE_PAPER = '#29213d'

// Module variables start over on a reload; the catalog is cheap to rebuild.
let catalog: RoleEntry[] | null = null
let loading: Promise<RoleEntry[]> | null = null
let viewing: { entry: RoleEntry; body: string } | null = null
// How many picker cards fit, as the last draw measured it.
let pickerSize = 6
// Whether the picker has held the keys since it opened, and the timer watching it:
// Esc hands the keys back to the prompt, and losing them closes the picker.
let pickerWasFocused = false
let pickerWatch: Timer | null = null

async function home($: EngineInterface) {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
}

// Highest precedence first: project, shared user catalog, Pi's catalog, then the
// roles this plugin ships (agency-agents and the custom ones), so it works anywhere.
async function roots($: EngineInterface) {
  const userHome = await home($)
  const cwd = (await $.session.cwd()).replace(/\\/g, '/')
  const bundled = `${$.plugin.root.replace(/\\/g, '/')}/roles`

  return [`${cwd}/.claude/roles`, `${userHome}/.agents/roles`, `${userHome}/.pi/agent/roles`, bundled]
}

async function statePath($: EngineInterface, sessionId: string) {
  return `${await home($)}/.claude/roles-mod/state/${sessionId}.json`
}

async function scan($: EngineInterface, dir: string, category: string, seen: Map<string, RoleEntry>) {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir') {
      await scan($, path, entry.name, seen)
    } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      const id = entry.name.slice(0, -3).toLowerCase()
      if (!isValidRoleId(id) || seen.has(id)) continue
      try {
        seen.set(id, entryFromFile(id, path, category, await $.fs.read(path)))
      } catch {
        // An unreadable file never breaks the catalog.
      }
    }
  }
}

function loadCatalog($: EngineInterface, isFresh = false): Promise<RoleEntry[]> {
  if (catalog && !isFresh) return Promise.resolve(catalog)
  if (loading && !isFresh) return loading
  loading = (async () => {
    const seen = new Map<string, RoleEntry>()
    for (const root of await roots($)) await scan($, root, '', seen)
    catalog = [...seen.values()]
    loading = null

    return catalog
  })()

  return loading
}

async function bodyOf($: EngineInterface, entry: RoleEntry) {
  return parseRoleFile(await $.fs.read(entry.path)).body
}

// The band above the prompt draws the role from `active`; this file is for the
// status line command (Herdr) and resumed sessions.
async function publish($: EngineInterface, role: ActiveRole | null) {
  const sessionId = await $.session.id()
  await $.store.set(`session:${sessionId}`, role?.id ?? null)
  await $.fs.write(
    await statePath($, sessionId),
    JSON.stringify({ ...(role ?? { id: null, name: null, category: null }), updatedAt: await $.clock.now() }),
  )
}

async function activate($: EngineInterface, entry: RoleEntry | null) {
  const role: ActiveRole | null = entry ? { id: entry.id, name: entry.name, category: entry.category } : null
  await update($, active, () => role)
  await publish($, role)
  $.ui.toast(role ? `Role: ${role.name}` : 'Role: default')
}

async function findExact($: EngineInterface, text: string) {
  const wanted = text.trim().toLowerCase()
  const list = await loadCatalog($)

  return list.find(one => one.id === wanted) ?? list.find(one => one.name.toLowerCase() === wanted)
}

// The picker's rows: `null` (default) first, then the matches.
async function pickerItems($: EngineInterface): Promise<(RoleEntry | null)[]> {
  return [null, ...searchRoles(await loadCatalog($), await read($, query))]
}

function slotKey(slot: number) {
  return `slot-${slot}`
}

function slotOf(key: string | undefined) {
  const match = key ? /^slot-(\d+)$/.exec(key) : null

  return match ? Number(match[1]) : -1
}

async function watchPicker($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PICKER)
  if (pane?.isFocused) {
    pickerWasFocused = true

    return
  }
  if (pane && !pickerWasFocused) return
  pickerWatch?.cancel()
  pickerWatch = null
  pickerWasFocused = false
  if (pane) await $.ui.close({ id: PICKER })
}

async function openPicker($: EngineInterface, initial: string) {
  await update($, query, () => initial)
  await update($, windowAt, () => 0)
  await update($, focusedSlot, () => -1)
  pickerWasFocused = false
  pickerWatch?.cancel()
  pickerWatch = $.clock.every(250, () => void watchPicker($))
  await $.ui.open({ id: PICKER, title: 'Role', focus: true, closeOnEscape: true, holdToasts: true, rows: 32 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'role',
      description: 'Pick the professional role of this conversation (searchable); /role <id>, /role none, /role show',
      argumentHint: '[id | search | none | show]',
    })
    await $.command.register({
      name: 'roles',
      description: 'List professional roles, optionally filtered; /roles refresh rescans the catalog',
      argumentHint: '[search | refresh]',
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Search or read the professional role catalog. action "list" (optional query, offset, limit 1-50) returns ids, names, categories and descriptions; action "show" (id) returns a role\'s instructions. Read-only: it selects nothing. To give a subagent a role, start the Agent prompt with `--role <id>`.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'show'] },
          query: { type: 'string' },
          id: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['action'],
      },
    })

    // A resumed session gets its role back; a new one starts on default, as in Pi.
    const sessionId = await $.session.id()
    const stored = await $.store.get(`session:${sessionId}`)
    let role: ActiveRole | null = await read($, active)
    if (role === null && typeof stored === 'string') {
      const entry = await findExact($, stored)
      if (entry) role = { id: entry.id, name: entry.name, category: entry.category }
    }
    await update($, active, () => role)
    await publish($, role)
    // An earlier version pinned the role as a status line entry: clear it.
    $.ui.status(undefined)

    return next(e)
  })

  // The active role above the prompt. Reading `active` here redraws the band as
  // soon as /role writes it. Default shows nothing, a survey keeps the band, and
  // another plugin's band stays, under the role.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const role = await read($, active)
    if (role === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Text bold color={ROLE_INK} backgroundColor={ROLE_PAPER}>
          {`${NBSP}Role: ${role.name}${NBSP}`}
        </Text>
        {below}
      </Box>
    )
  })

  on('command.run', { command: 'role' }, async ($, e) => {
    const args = e.args.trim()
    const current = await read($, active)

    if (args === '') {
      await openPicker($, '')

      return { text: current ? `Current role: ${current.name} (${current.id})` : 'Current role: default' }
    }
    if (['none', 'default', 'reset'].includes(args.toLowerCase())) {
      await activate($, null)

      return { text: 'Role cleared: default' }
    }
    if (args.toLowerCase() === 'show') {
      if (!current) return { text: 'No role is active (default).' }
      const entry = await findExact($, current.id)
      if (!entry) return { text: `Role ${current.id} is no longer in the catalog.` }
      viewing = { entry, body: await bodyOf($, entry) }
      await $.ui.open({ id: VIEWER, title: `Role: ${entry.name}`, focus: true, closeOnEscape: true })

      return { text: `Showing ${entry.name}.` }
    }

    const exact = await findExact($, args)
    if (exact) {
      await activate($, exact)

      return { text: `Role: ${exact.name} (${exact.id})` }
    }
    await openPicker($, args)

    return { text: `No role is exactly "${args}"; pick one from the search.` }
  })

  on('command.run', { command: 'roles' }, async ($, e) => {
    const args = e.args.trim()
    if (args.toLowerCase() === 'refresh') {
      const list = await loadCatalog($, true)

      return { text: `Role catalog rescanned: ${list.length} roles.` }
    }
    const list = await loadCatalog($)
    const found = searchRoles(list, args)
    const shown = found.slice(0, 50).map(one => `${one.id} — ${one.name} [${one.category}]`)
    const more = found.length > shown.length ? `\n… ${found.length - shown.length} more; narrow the search or use /role.` : ''

    return { text: `${found.length} of ${list.length} roles${args ? ` match "${args}"` : ''}:\n${shown.join('\n')}${more}` }
  })

  // The model's read-only window on the catalog.
  on('tool.call', { tool: 'mcp__roles__roles' }, async ($, e) => {
    const input = e as unknown as { action?: string; query?: string; id?: string; offset?: number; limit?: number }
    const list = await loadCatalog($)
    if (input.action === 'show') {
      const entry = input.id ? await findExact($, input.id) : undefined
      if (!entry) return { result: `No role "${input.id ?? ''}". Use action "list" to search.` }

      return { result: `# ${entry.name} (${entry.id}) — ${entry.category}\n${entry.description}\n\n${await bodyOf($, entry)}` }
    }
    const found = searchRoles(list, input.query ?? '')
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(50, Math.max(1, input.limit ?? 20))
    const page = found.slice(offset, offset + limit)
    const lines = page.map(one => `${one.id} | ${one.name} | ${one.category} | ${one.description.slice(0, 200)}`)
    const nextOffset = offset + page.length < found.length ? `\nnextOffset: ${offset + page.length}` : ''

    return { result: `${found.length} matching roles (id | name | category | description):\n${lines.join('\n')}${nextOffset}` }
  })

  // The role reaches the main conversation as context beside the person's prompt
  // (subagents get theirs through --role): the full text once per role, then one
  // line per prompt, and a note when it is cleared.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const notes: string[] = []
    if (!(await read($, hinted))) {
      notes.push(DELEGATION_HINT)
      await update($, hinted, () => true)
    }
    const role = await read($, active)
    const entry = role ? await findExact($, role.id) : undefined
    const kind = roleNoteKind(entry?.id ?? null, await read($, announced))
    if (kind === 'full' && entry) {
      notes.push(fullNote(entry, await bodyOf($, entry)))
      await update($, announced, () => entry.id)
    } else if (kind === 'reminder' && entry) {
      notes.push(reminderNote(entry))
    } else if (kind === 'cleared') {
      notes.push(CLEARED_NOTE)
      await update($, announced, () => null)
    }
    if (notes.length === 0) return next(e)

    return next({ ...e, context: [...(e.context ?? []), notes.join('\n\n')] })
  }).catch(($, e, next) => next(e))

  // A compaction or /clear may drop the full text: send it again on the next prompt.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await update($, announced, () => null)
    await update($, hinted, () => false)

    return compacted
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, announced, () => null)
      await update($, hinted, () => false)
    }

    return next(e)
  })

  // `--role <id>` at the head of a delegated prompt: the role is composed in front
  // of the task and named in the description, so the job card shows it.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const flag = parseRoleFlag(e.prompt)
    if (flag.kind === 'absent') return next(e)
    if (flag.kind === 'invalid') return { deny: `roles: ${flag.reason}. Use --role <id>, or --role none.` }
    if (flag.kind === 'clear') return next({ ...e, prompt: flag.rest })

    const entry = await findExact($, flag.id)
    if (!entry) {
      const near = suggestRoles(await loadCatalog($), flag.id)
      const hint = near.length ? ` Close matches: ${near.map(one => one.id).join(', ')}.` : ''

      return { deny: `roles: no role "${flag.id}".${hint} The subagent was not started; retry with an existing id.` }
    }

    return next({
      ...e,
      prompt: `${rolePrompt(entry, await bodyOf($, entry))}\n\n---\n\n${flag.rest}`,
      description: `${e.description} · ${entry.name}`,
    })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Use /role &lt;id&gt; here; the search needs a keyboard surface.</Text>
    }
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const list = await loadCatalog($)
    const text = await read($, query)
    const current = await read($, active)
    const items = await pickerItems($)
    // A fixed set of slots (always the same keys) shows a window of the list:
    // the focus ring only reaches elements drawn when the pane took the keys,
    // so the cards stay put and their contents scroll (the ui.focus hook).
    // Rows: search, hint, a blank, then 3 per card (name, description, gap).
    pickerSize = Math.max(2, Math.floor((e.props.scroll.bodyRows - 3 + 1) / 3))
    const start = Math.min(await read($, windowAt), Math.max(0, items.length - pickerSize))
    const shown = items.slice(start, start + pickerSize)
    const width = Math.max(30, (e.props.bodyColumns ?? 80) - 6)
    // A card's rows run the whole body, less one column so none wraps.
    const full = Math.max(30, (e.props.bodyColumns ?? 80) - 1)
    const cut = (value: string, room: number) => (value.length > room ? `${value.slice(0, Math.max(1, room - 1))}…` : value)
    const found = items.length - 1
    const focused = await read($, focusedSlot)

    const pick = async (entry: RoleEntry | null) => {
      await activate($, entry)
      await $.ui.close({ id: PICKER })
    }
    // Read the window again at press time: a slot's role is whatever it shows now.
    const pickSlot = async (slot: number) => {
      const now = await pickerItems($)
      const at = Math.min(await read($, windowAt), Math.max(0, now.length - pickerSize)) + slot
      if (at < now.length) await pick(now[at] ?? null)
    }

    return (
      <Box flexDirection="column">
        <Input
          key="q"
          label="Search"
          placeholder="name, category, id or description"
          value={text}
          autoFocus
          onInput={(value: string) => {
            void update($, query, () => value)
            void update($, windowAt, () => 0)
          }}
          // Enter in the box picks the top match once something was typed; on an
          // empty search it closes the picker, the role unchanged (the search box
          // swallows Escape, so this is the way out from the keyboard).
          onSubmit={(value: string) => {
            const top = items[1]
            if (value.trim() !== '' && top) void pick(top)
            else if (value.trim() === '') void $.ui.close({ id: PICKER })
          }}
        />
        <Text dimColor>
          {cut(
            `${found}/${list.length} · ${start + 1}-${start + shown.length} · ${
              text.trim() !== '' && items[1] ? `Enter here: ${items[1].name}` : 'Enter here (empty): close'
            } · ↓/Tab into the list, ↑ back to search · Enter on a card picks it`,
            width + 4,
          )}
        </Text>
        <Box flexDirection="column" marginTop={1} rowGap={1}>
          {shown.map((entry, slot) => {
            const isCurrent = entry === null ? current === null : current?.id === entry.id
            const name = entry?.name ?? 'default'
            const category = entry?.category ?? ''
            const detail = entry ? entry.description || entry.id : "No role: Claude's own defaults."
            const marker = isCurrent ? '● ' : NBSP.repeat(2)
            const tail = category ? `${NBSP.repeat(2)}${category}` : ''
            const title = cut(name, full - 2 - tail.length)
            const line = cut(detail, full - 4)
            const indent = NBSP.repeat(4)

            // The engine marks the focused Button by inverting its colours, and
            // only where there is text. The focused card is drawn pre-inverted
            // (white text becomes the background) and padded to the full width.
            if (slot === focused && e.props.isFocused) {
              const paper = { color: '#ffffff' }
              const ink = isCurrent ? '#0f766e' : '#111111'

              return (
                <Button key={slotKey(slot)} plain onPress={() => void pickSlot(slot)}>
                  <Text {...paper} backgroundColor={ink}>
                    {marker}
                  </Text>
                  <Text bold {...paper} backgroundColor={ink}>
                    {title}
                  </Text>
                  <Text {...paper} backgroundColor={MUTED_INK}>
                    {tail + NBSP.repeat(Math.max(0, full - 2 - title.length - tail.length))}
                  </Text>
                  {'\n'}
                  <Text {...paper} backgroundColor={MUTED_INK}>
                    {indent + line + NBSP.repeat(Math.max(0, full - 4 - line.length))}
                  </Text>
                </Button>
              )
            }

            return (
              <Button key={slotKey(slot)} plain onPress={() => void pickSlot(slot)}>
                {marker}
                <Text bold color={isCurrent ? '#6ee7dc' : undefined}>
                  {title}
                </Text>
                <Text dimColor>{tail}</Text>
                {'\n'}
                <Text dimColor>{indent + line}</Text>
              </Button>
            )
          })}
        </Box>
      </Box>
    )
  })

  // Arrow or Tab onto the last (or first) slot while more lies beyond: scroll the
  // contents one row and keep the ring one slot in, so the next arrow scrolls again.
  on('ui.focus', { requestId: PICKER }, async ($, e, next) => {
    const slot = slotOf(e.element)
    if (slot < 0) {
      await update($, focusedSlot, () => -1)

      return next(e)
    }
    const total = (await pickerItems($)).length
    const start = Math.min(await read($, windowAt), Math.max(0, total - pickerSize))
    const plan = slideFocus(slot, start, pickerSize, total)
    if (plan.start !== start) await update($, windowAt, () => plan.start)
    await update($, focusedSlot, () => plan.slot)

    return next(plan.slot === slot ? e : { ...e, element: slotKey(plan.slot) })
  })

  on('ui.render', { component: 'Pane', requestId: VIEWER }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    if (!viewing) return <Text dimColor>No role to show.</Text>

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {viewing.entry.category} · {viewing.entry.id}
        </Text>
        <Markdown key="body" text={viewing.body} />
      </Box>
    )
  })
}
