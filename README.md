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

## Role on screen

While a role is active the plugin draws ` Role: <name> ` in the band right
above the prompt, in `#6ee7dc` on `#29213d`; on default the band shows nothing.
The engine draws it from the plugin's state, so `/role` shows at once, with no
status line command and no timer. A survey takes the band while it is up, and
another plugin's band stays, under the role.

## Status line with claude-hud (optional)

`statusline/` is a small Go program for the `statusLine` command that runs
[claude-hud](https://github.com/jarrodwatts/claude-hud) without slowing the
machine down, and reports model, effort and role to the Herdr terminal
multiplexer's `$model_info` token when it runs inside Herdr.

Why: Claude Code runs the status line after every update and cancels a run
still going when the next update comes (on Windows with `taskkill /T`, which
goes through WMI). claude-hud takes most of a second, so with a few sessions,
and worse with a `refreshInterval`, those cancellations pile up and stall the
whole machine. This program prints claude-hud's last drawing at once and has a
detached copy of itself redraw: one per session at a time, at most every 1.5 s,
outside the process tree a cancellation kills. The drawing is one update
behind; the role is not affected (it is pinned by the plugin).

1. Install claude-hud.
2. Build it into `~/.claude/roles-mod/` (the plugin writes the role state it
   reads for Herdr to `~/.claude/roles-mod/state/`, where it keeps its cache):

   ```
   cd statusline
   go build -ldflags="-s -w" -trimpath -o ~/.claude/roles-mod/statusline.exe .
   ```

3. Point the status line at it in `~/.claude/settings.json`, with no
   `refreshInterval` (every tick would start a shell and a process per session):

```json
"statusLine": {
  "type": "command",
  "command": "exec \"$HOME/.claude/roles-mod/statusline.exe\""
}
```

Off Windows, name the binary without `.exe`.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT (see `LICENSE`). The agency-agents roles keep their MIT license,
in `roles/LICENSE-agency-agents`.
