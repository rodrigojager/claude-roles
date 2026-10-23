#!/usr/bin/env node
// Status line wrapper: runs claude-hud unchanged, then puts the session's role
// (written by the `roles` mod) right after the model badge on the first line,
// and reports model/effort/role to Herdr when it changes.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const STATE_DIR = join(HOME, ".claude", "roles-mod", "state");
const HUD = join(process.env.CLAUDE_CONFIG_DIR ?? join(HOME, ".claude"), "plugins", "claude-hud", "statusline.mjs");
const ESC = "\x1b[";
const ACTIVE = `${ESC}1;38;2;110;231;220;48;2;41;33;61m`; // #6ee7dc on #29213d, as pi-goal-highlight
const MUTED = `${ESC}2m`;
const RESET = `${ESC}0m`;
const HUD_MAX_AGE_MS = 30_000;

const input = readFileSync(0, "utf8");
let data = {};
try {
  data = JSON.parse(input);
} catch {}

const sessionId = typeof data.session_id === "string" && /^[\w-]+$/.test(data.session_id) ? data.session_id : null;
const role = readRole(sessionId);

const hud = renderHud(sessionId, data);

const badge = role ? `${ACTIVE} Role: ${role.name} ${RESET}` : `${MUTED}Role: default${RESET}`;
const lines = hud.replace(/\n+$/, "").split("\n");
if (lines.length === 0 || lines[0] === "") {
  lines[0] = badge;
} else {
  const at = lines[0].indexOf(" │ ");
  lines[0] = at === -1 ? `${lines[0]} │ ${badge}` : `${lines[0].slice(0, at)} │ ${badge}${lines[0].slice(at)}`;
}
process.stdout.write(lines.join("\n") + "\n");

reportHerdr(sessionId, data, role);
pruneOldState();

// claude-hud takes ~350 ms (it reads the transcript). With a refreshInterval
// the status line runs every second so a role change shows at once; between
// messages nothing it draws has changed, so its last output is reused, and it
// runs again on new data or after HUD_MAX_AGE_MS (its durations tick then).
function renderHud(id, stdin) {
  const run = () => {
    try {
      return execFileSync(process.execPath, [HUD], { input, encoding: "utf8", timeout: 8000, windowsHide: true });
    } catch (error) {
      return typeof error?.stdout === "string" ? error.stdout : "";
    }
  };
  if (!id) return run();
  const steady = { ...stdin, cost: { ...(stdin.cost ?? {}), total_duration_ms: undefined } };
  const key = JSON.stringify(steady);
  const cache = join(STATE_DIR, `${id}.hud.json`);
  try {
    const kept = JSON.parse(readFileSync(cache, "utf8"));
    if (kept.key === key && Date.now() - kept.at < HUD_MAX_AGE_MS) return kept.out;
  } catch {}
  const out = run();
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(cache, JSON.stringify({ key, at: Date.now(), out }));
  } catch {}
  return out;
}

function readRole(id) {
  if (!id) return null;
  try {
    const state = JSON.parse(readFileSync(join(STATE_DIR, `${id}.json`), "utf8"));
    return typeof state.id === "string" && typeof state.name === "string" ? state : null;
  } catch {
    return null;
  }
}

// Herdr shows `$model_info` in its agents sidebar; only send when it changes.
function reportHerdr(id, stdin, current) {
  const pane = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !pane || !id) return;
  const model = stdin?.model?.display_name ?? stdin?.model?.id ?? "";
  const effort = stdin?.effort?.level ?? "";
  const info = [[model, effort].filter(Boolean).join(" "), current ? current.name : "default"].filter(Boolean).join(" · ");
  const cache = join(STATE_DIR, `${id}.herdr`);
  try {
    if (existsSync(cache) && readFileSync(cache, "utf8") === info) return;
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(cache, info);
  } catch {
    return;
  }
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  const args = ["pane", "report-metadata", pane, "--source", "claude-model", "--agent", "claude",
    "--applies-to-source", "herdr:claude", "--token", `model_info=${info}`];
  try {
    spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

// State files are tiny; drop the ones untouched for two weeks, at most daily.
function pruneOldState() {
  const marker = join(STATE_DIR, ".pruned");
  const now = Date.now();
  try {
    if (existsSync(marker) && now - statSync(marker).mtimeMs < 86_400_000) return;
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(marker, String(now));
    for (const name of readdirSync(STATE_DIR)) {
      if (name === ".pruned") continue;
      const path = join(STATE_DIR, name);
      if (now - statSync(path).mtimeMs > 14 * 86_400_000) unlinkSync(path);
    }
  } catch {}
}
