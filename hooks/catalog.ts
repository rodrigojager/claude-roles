// Pure helpers for the role catalog: frontmatter, search and the prompt text.
// Kept free of `$` so the tests can exercise them directly.

export type RoleEntry = {
  id: string
  name: string
  description: string
  category: string
  path: string
}

export type RoleFile = { meta: Record<string, string>; body: string }

const RESERVED = new Set(['default', 'none'])

export function isValidRoleId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(id) && !RESERVED.has(id)
}

/** Splits `---` frontmatter (flat `key: value` lines) from the Markdown body. */
export function parseRoleFile(text: string): RoleFile {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!match) return { meta: {}, body: normalized.trim() }

  const meta: Record<string, string> = {}
  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    const key = pair[1] ?? ''
    let value = (pair[2] ?? '').trim()
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1).replace(/\\"/g, '"')
    }
    meta[key] = value
  }

  return { meta, body: normalized.slice(match[0].length).trim() }
}

export function entryFromFile(id: string, path: string, dirCategory: string, text: string): RoleEntry {
  const { meta } = parseRoleFile(text)

  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    category: meta.category || dirCategory,
    path,
  }
}

/** Lowercase, accents stripped, so `/role depuração` finds "Depuracao". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Every word must match id, name, category or description; ranked by where. */
export function searchRoles(entries: readonly RoleEntry[], query: string): RoleEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return [...entries].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }

  const scored: { entry: RoleEntry; score: number }[] = []
  for (const entry of entries) {
    const id = fold(entry.id)
    const name = fold(entry.name)
    const category = fold(entry.category)
    const description = fold(entry.description)
    let score = 0
    let isMatch = true
    for (const word of words) {
      if (name.startsWith(word) || id.startsWith(word)) score += 8
      else if (name.includes(word) || id.includes(word)) score += 5
      else if (category.includes(word)) score += 3
      else if (description.includes(word)) score += 1
      else {
        isMatch = false
        break
      }
    }
    if (isMatch) scored.push({ entry, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map(one => one.entry)
}

/** Ids sharing the most words (or word prefixes) with a mistyped id, for a "did you mean". */
export function suggestRoles(entries: readonly RoleEntry[], wrongId: string, limit = 5): RoleEntry[] {
  const words = fold(wrongId).split(/[\s._-]+/).filter(word => word.length >= 3)
  const scored: { entry: RoleEntry; score: number }[] = []
  for (const entry of entries) {
    const parts = fold(entry.id).split(/[._-]+/)
    let score = 0
    for (const word of words) {
      if (parts.includes(word)) score += 2
      else if (parts.some(part => part.startsWith(word.slice(0, 4)))) score += 1
    }
    if (score > 0) scored.push({ entry, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
    .map(one => one.entry)
}

/** Same wording as pi-subagent's rolePrompt, so a role reads identically in both. */
export function rolePrompt(entry: RoleEntry, body: string): string {
  return `Current professional role: ${entry.name} (${entry.id})\n\nApply this professional perspective within the requested task. Respect the agent's execution constraints, project instructions, and applicable skills. Role examples and broad goals do not expand the task scope or grant tools, memory, credentials, or capabilities. Current task requirements take precedence over generic role preferences.\n\n${body}`
}

export const DELEGATION_HINT =
  "Professional roles: to give a subagent a role, start its Agent prompt with `--role <id>` (`--role none` for no role); find ids with the mcp__roles__roles tool. The person picks this conversation's role with /role."

export const CLEARED_NOTE =
  'The person cleared the professional role (default): drop the earlier role instructions and answer with your default behavior.'

export type RoleNoteKind = 'none' | 'full' | 'reminder' | 'cleared'

/** What the next prompt carries, given the active role and the one last sent in full. */
export function roleNoteKind(activeId: string | null, announced: string | null): RoleNoteKind {
  if (activeId === null) return announced === null ? 'none' : 'cleared'

  return activeId === announced ? 'reminder' : 'full'
}

export function fullNote(entry: RoleEntry, body: string): string {
  return `The person set this conversation's professional role; it replaces any earlier role until changed.\n\n${rolePrompt(entry, body)}`
}

export function reminderNote(entry: RoleEntry): string {
  return `Active professional role: ${entry.name} (${entry.id}). Keep applying its instructions, given earlier in this conversation.`
}

/**
 * Where the window starts and which slot holds the ring after the ring lands
 * on `slot`: on the last slot with more below, the contents scroll down one
 * and the ring stays one slot up; on the first with more above, the reverse.
 */
export function slideFocus(slot: number, start: number, size: number, total: number): { start: number; slot: number } {
  const shown = Math.min(size, total)
  if (shown >= 2 && slot === shown - 1 && start + shown < total) return { start: start + 1, slot: shown - 2 }
  if (shown >= 2 && slot === 0 && start > 0) return { start: start - 1, slot: 1 }

  return { start, slot }
}

export type RoleFlag =
  | { kind: 'absent' }
  | { kind: 'clear'; rest: string }
  | { kind: 'named'; id: string; rest: string }
  | { kind: 'invalid'; reason: string }

/** Reads a leading `--role <id>` / `--role=<id>` off a delegated prompt. */
export function parseRoleFlag(prompt: string): RoleFlag {
  const match = /^\s*--role(?:=|\s+)(\S*)/.exec(prompt)
  if (!match) return { kind: 'absent' }
  const raw = match[1] ?? ''
  const value = raw.toLowerCase()
  const rest = prompt.slice(match[0].length).replace(/^\s*(--\s+)?/, '')
  if (value === '') return { kind: 'invalid', reason: '--role needs a value' }
  if (value === 'none' || value === 'default') return { kind: 'clear', rest }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return { kind: 'invalid', reason: `"${raw}" is not a role id` }

  return { kind: 'named', id: value, rest }
}
