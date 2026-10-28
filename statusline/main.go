// Command statusline is the Claude Code status line for claude-hud and the
// roles mod.
//
// Claude Code runs it after every update and cancels a run still going when
// the next one comes (on Windows through `taskkill /T`, which goes through WMI:
// with a few sessions and a slow script that alone could stall the machine).
// claude-hud takes most of a second, so this never waits for it: it prints
// claude-hud's last drawing at once and has a detached copy of itself redraw,
// one per session at a time, at most once per minGap. The display is therefore
// one update behind, which a status line can afford.
//
// The role itself is not drawn here: the roles mod pins it with $.ui.status, so
// a /role shows at once without any timer. This still reports model, effort and
// role to Herdr, only when they change.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	hudMaxAge  = 30 * time.Second        // redraw at least this often while updates come (its durations tick)
	minGap     = 1500 * time.Millisecond // between two drawings of one session
	lockMaxAge = 60 * time.Second        // a renderer older than this died: take over
	hudTimeout = 20 * time.Second
	pruneAge   = 14 * 24 * time.Hour
)

var sessionRx = regexp.MustCompile(`^[\w-]+$`)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--render" {
		render(os.Args[2])
		return
	}

	input, _ := io.ReadAll(os.Stdin)
	var data map[string]any
	_ = json.Unmarshal(input, &data)

	id, _ := data["session_id"].(string)
	if !sessionRx.MatchString(id) {
		os.Stdout.Write(runHud(input))
		return
	}

	dir := stateDir()
	_ = os.MkdirAll(dir, 0o755)
	base := filepath.Join(dir, id)
	_ = writeAtomic(base+".hud-in.json", input)

	out, err := os.ReadFile(base + ".hud.out")
	if err != nil {
		out = []byte(placeholder(data) + "\n")
	}
	if needsDrawing(base, steadyKey(data)) && takeLock(base) {
		if !startRenderer(id) {
			_ = os.Remove(base + ".hud.lock")
		}
	}
	os.Stdout.Write(out)

	reportHerdr(id, base, data)
	prune(dir)
}

// render draws until the newest input has been drawn, then gives the lock back.
func render(id string) {
	if !sessionRx.MatchString(id) {
		return
	}
	base := filepath.Join(stateDir(), id)
	for {
		for {
			input, err := os.ReadFile(base + ".hud-in.json")
			if err != nil {
				break
			}
			var data map[string]any
			_ = json.Unmarshal(input, &data)
			key := steadyKey(data)
			if !needsDrawing(base, key) {
				break
			}
			if st, err := os.Stat(base + ".hud.out"); err == nil {
				if wait := minGap - time.Since(st.ModTime()); wait > 0 {
					time.Sleep(wait)
				}
			}
			_ = touch(base + ".hud.lock")
			if out := runHud(input); len(out) > 0 {
				_ = writeAtomic(base+".hud.out", out)
				_ = writeAtomic(base+".hud.key", []byte(key))
			} else {
				break // claude-hud failed: keep the last drawing, try on the next update
			}
		}
		_ = os.Remove(base + ".hud.lock")

		// An update that came while the lock was given back saw it taken: look once more.
		input, err := os.ReadFile(base + ".hud-in.json")
		if err != nil {
			return
		}
		var data map[string]any
		_ = json.Unmarshal(input, &data)
		if !needsDrawing(base, steadyKey(data)) || !takeLock(base) {
			return
		}
	}
}

// needsDrawing: the input changed (durations aside) or the drawing is old.
func needsDrawing(base, key string) bool {
	kept, err := os.ReadFile(base + ".hud.key")
	if err != nil || string(kept) != key {
		return true
	}
	st, err := os.Stat(base + ".hud.out")
	return err != nil || time.Since(st.ModTime()) > hudMaxAge
}

// steadyKey identifies what claude-hud draws from, less the session's running time.
func steadyKey(data map[string]any) string {
	steady := make(map[string]any, len(data))
	for k, v := range data {
		steady[k] = v
	}
	if cost, ok := data["cost"].(map[string]any); ok {
		c := make(map[string]any, len(cost))
		for k, v := range cost {
			if k != "total_duration_ms" {
				c[k] = v
			}
		}
		steady["cost"] = c
	}
	b, _ := json.Marshal(steady) // map keys come out sorted
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func runHud(input []byte) []byte {
	ctx, cancel := context.WithTimeout(context.Background(), hudTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodePath(), filepath.Join(configDir(), "plugins", "claude-hud", "statusline.mjs"))
	cmd.Stdin = bytes.NewReader(input)
	hideWindow(cmd)
	out, _ := cmd.Output()
	return out
}

func startRenderer(id string) bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	cmd := exec.Command(exe, "--render", id)
	if !startDetached(cmd) {
		return false
	}
	_ = cmd.Process.Release()
	return true
}

func takeLock(base string) bool {
	path := base + ".hud.lock"
	for attempt := 0; attempt < 2; attempt++ {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			f.Close()
			return true
		}
		if !errors.Is(err, fs.ErrExist) {
			return false
		}
		st, err := os.Stat(path)
		if err != nil || time.Since(st.ModTime()) < lockMaxAge {
			return false
		}
		_ = os.Remove(path)
	}
	return false
}

// placeholder stands in on a session's first update, while the first drawing is made.
func placeholder(data map[string]any) string {
	if m, ok := data["model"].(map[string]any); ok {
		if name, ok := m["display_name"].(string); ok && name != "" {
			return "[" + name + "]"
		}
	}
	return "…"
}

// Herdr shows `$model_info` in its agents sidebar; only send when it changes.
func reportHerdr(id, base string, data map[string]any) {
	pane := os.Getenv("HERDR_PANE_ID")
	if os.Getenv("HERDR_ENV") != "1" || pane == "" {
		return
	}
	model, effort := "", ""
	if m, ok := data["model"].(map[string]any); ok {
		if model, _ = m["display_name"].(string); model == "" {
			model, _ = m["id"].(string)
		}
	}
	if e, ok := data["effort"].(map[string]any); ok {
		effort, _ = e["level"].(string)
	}
	role := "default"
	var state struct {
		ID   *string `json:"id"`
		Name *string `json:"name"`
	}
	if b, err := os.ReadFile(base + ".json"); err == nil && json.Unmarshal(b, &state) == nil && state.ID != nil && state.Name != nil {
		role = *state.Name
	}
	info := strings.TrimSpace(strings.Join(nonEmpty(model, effort), " "))
	info = strings.Join(nonEmpty(info, role), " · ")

	cache := base + ".herdr"
	if kept, err := os.ReadFile(cache); err == nil && string(kept) == info {
		return
	}
	if writeAtomic(cache, []byte(info)) != nil {
		return
	}
	bin := os.Getenv("HERDR_BIN_PATH")
	if bin == "" {
		bin = "herdr"
	}
	cmd := exec.Command(bin, "pane", "report-metadata", pane, "--source", "claude-model", "--agent", "claude",
		"--applies-to-source", "herdr:claude", "--token", "model_info="+info)
	if startDetached(cmd) {
		_ = cmd.Process.Release()
	}
}

// State files are tiny; drop the ones untouched for two weeks, at most daily.
func prune(dir string) {
	marker := filepath.Join(dir, ".pruned")
	if st, err := os.Stat(marker); err == nil && time.Since(st.ModTime()) < 24*time.Hour {
		return
	}
	_ = touch(marker)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() == ".pruned" {
			continue
		}
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > pruneAge {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func homeDir() string {
	h, _ := os.UserHomeDir()
	return h
}

func configDir() string {
	if d := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); d != "" {
		return d
	}
	return filepath.Join(homeDir(), ".claude")
}

// Where the roles mod writes each session's role (it always uses ~/.claude).
func stateDir() string { return filepath.Join(homeDir(), ".claude", "roles-mod", "state") }

func nodePath() string {
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	return `C:\Program Files\nodejs\node.exe`
}

func writeAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func touch(path string) error {
	now := time.Now()
	if err := os.Chtimes(path, now, now); err == nil {
		return nil
	}
	return os.WriteFile(path, nil, 0o644)
}

func nonEmpty(values ...string) []string {
	out := values[:0:0]
	for _, v := range values {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}
