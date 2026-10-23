# claude-roles

Professional roles for Claude Code. A role is a persona: it changes how Claude
approaches the task (a Code Reviewer, a Root Cause Debugger, a UX Researcher...),
never which tools, models or permissions it has.

The plugin ships 285 roles: 282 from
[agency-agents](https://github.com/msitarzewski/agency-agents) plus 3 custom ones
(`roles/custom/`). It is a port of the roles in
[pi-subagent](https://github.com/rodrigojager/pi-subagent), with the same prompt
wording, so a role reads the same in both.

## Install

At the prompt of a terminal session:

```
/plugin install roles --marketplace rodrigojager/claude-roles
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one).

From a shell:

```
claude plugin install roles --marketplace rodrigojager/claude-roles
```

## Use

| Command | What it does |
| --- | --- |
| `/role` | Opens the picker: type to filter (name, id, category, description; accents ignored), ↓/Tab into the list, Enter picks, Esc closes. Enter on an empty search also closes. |
| `/role <id>` | Activates a role directly, e.g. `/role code-reviewer`. |
| `/role none` | Back to default (no role). |
| `/role show` | Shows the active role's text in a pane. |
| `/roles [search]` | Lists roles; `/roles refresh` rescans the catalog. |

- **Main conversation:** the role reaches Claude with your next message: its
  full text once, then a one-line reminder per message. Changing or clearing
  it is announced the same way. After a compaction or `/clear` the full text
  is sent again. A new session starts on default; a resumed one gets its role back.
- **Subagents:** start an Agent prompt with `--role <id>` (or `--role none`).
  The role is put in front of the task and named on the job card. An unknown
  id stops the launch and suggests close matches. Claude is told about this
  and can look roles up with the read-only `roles` tool (`list`, `show`).

### Shortcut

Bind a key to the picker in `~/.claude/keybindings.json`:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [{ "context": "Chat", "bindings": { "alt+r": "command:role" } }]
}
```

## Your own roles

A role is a Markdown file with frontmatter:

```markdown
---
name: "My Reviewer"
description: "What it is for, in one line"
category: "engineering"
---

The instructions...
```

Its id is the file name without `.md` (lowercase; `default` and `none` are
reserved). Catalogs are read in this order, the first one with an id winning:

1. `<project>/.claude/roles/`
2. `~/.agents/roles/` (shared with other agents)
3. `~/.pi/agent/roles/` (Pi's)
4. the roles shipped here

Subfolders are categories when the frontmatter has none.

## Role in the status line (optional)

`statusline/statusline.mjs` wraps [claude-hud](https://github.com/jarrodwatts/claude-hud)
and puts the role right after the model: ` Role: Root Cause Debugger ` in
`#6ee7dc` on `#29213d` while one is active, a dim `Role: default` otherwise. It
also reports model, effort and role to the Herdr terminal multiplexer's
`$model_info` token when it runs inside Herdr.

1. Install claude-hud.
2. Copy `statusline/` to `~/.claude/roles-mod/` (the plugin writes the role
   state the wrapper reads to `~/.claude/roles-mod/state/`).
3. Point the status line at it in `~/.claude/settings.json`. `refreshInterval`
   makes a role change show within a second; the wrapper reuses claude-hud's
   output while nothing else changed, so each tick is cheap.

```json
"statusLine": {
  "type": "command",
  "command": "exec \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/roles-mod/statusline.cmd\"",
  "refreshInterval": 1
}
```

`statusline.cmd` is the Windows launcher and names `C:\Program Files\nodejs\node.exe`;
elsewhere, run `node ~/.claude/roles-mod/statusline.mjs` instead.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT (see `LICENSE`). The agency-agents roles keep their MIT license,
in `roles/LICENSE-agency-agents`.
