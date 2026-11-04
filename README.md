# opencode-caffeinate-turn

Keep your Mac awake **only while OpenCode is actively working a turn**. As soon as the turn finishes, or OpenCode stops to ask you a question or for a permission, the lock is released and macOS can sleep normally.

## Based on upstream

This is a fork of [nguyenphutrong/opencode-caffeinate](https://github.com/nguyenphutrong/opencode-caffeinate) (MIT, © Trong Nguyen), forked from `v0.1.3` (commit `ebc9c5c`).

| | Upstream | This fork |
|---|---|---|
| Starts `caffeinate` | when a session is created | when the agent starts working (`busy`/`retry`) |
| Stops `caffeinate` | when the session goes idle or is deleted | turn ends, a question/permission/form prompt appears, error, interrupt or delete |
| Resumes on answer | no | yes (`question`/`permission`/`form` replied) |
| OpenCode v2 plugin API | not loadable (no `Plugin.define` default export) | supported via `v2.ts` |
| Tests | session and caffeinate managers | plus event routing and v2 entry |

## What it does

While a turn is running it keeps `caffeinate -dim` alive:

- `-d`: prevent display sleep
- `-i`: prevent idle sleep
- `-m`: prevent disk sleep

It is released whenever OpenCode is waiting on you or has finished.

## Requirements

- macOS (uses the `caffeinate` command; the plugin disables itself on other platforms)
- [Bun](https://bun.sh) >= 1.0.0
- OpenCode with plugin support (v1 or v2)

## Installation

### OpenCode v2 (native plugin)

v2 needs a default export built with `Plugin.define`, which is `.opencode/plugin/v2.ts`.

```bash
git clone https://github.com/notsatyarth/opencode-caffeinate-turn.git ~/.config/opencode/opencode-caffeinate-turn
cd ~/.config/opencode/opencode-caffeinate-turn && bun install
```

Create `~/.config/opencode/plugins/caffeinate.ts` (or `.opencode/plugins/caffeinate.ts` in a project):

```ts
export { default } from "/Users/<you>/.config/opencode/opencode-caffeinate-turn/.opencode/plugin/v2.ts"
```

Restart OpenCode.

### OpenCode v1

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:notsatyarth/opencode-caffeinate-turn"]
}
```

or clone the repo into `~/.config/opencode/plugins/` (the v1 entry is `.opencode/plugin/index.ts`).

### Verify

```bash
# while the agent is working a turn:
pgrep -fl caffeinate          # -> caffeinate -dim
pmset -g assertions | grep -i caffeinate
# idle, or waiting on a question/permission: no caffeinate process
```

## How it works

- **Awake:** `session.status` = `busy`/`retry`; `question.replied`, `permission.replied` (and `.v2.` variants), `form.replied`, `session.execution.started`.
- **Allowed to sleep:** `session.status` = `idle`, `session.idle`; `question.asked`, `permission.asked`/`permission.updated` (waiting on you); `form.created`/`form.cancelled`; `session.execution.succeeded`/`failed`/`interrupted`; `question.rejected`; `session.error`; `session.deleted`.

Each working session is a file in `$TMPDIR/opencode-caffeinate-<uid>/sessions/` named `<pid>_<sessionID>.session`. One `caffeinate` process (PID in `caffeinate.pid` in the same directory) is shared by all OpenCode instances and stopped when no session is working. Sessions from crashed processes are ignored. The plugin also releases its sessions on dispose.

Start/stop decisions are made under a lock file (`state.lock`, created with `O_EXCL`; stale locks from dead or hung owners are reclaimed), so many OpenCode instances starting a turn at the same moment still spawn exactly one `caffeinate`.

## Security

- State lives in a per-user, `0700` directory under `$TMPDIR` (override with `OPENCODE_CAFFEINATE_DIR`). Symlinked or foreign-owned directories are refused; files are `0600`.
- The PID file is never trusted blindly: only plain integers > 1 are accepted, and before signalling, the PID is verified to be a `caffeinate` process owned by the current user (`/bin/ps`). Negative/group PIDs are rejected.
- Session IDs must match `^[A-Za-z0-9_-]{1,128}$`; anything else is ignored (no path traversal).
- `caffeinate` is launched by absolute path (`/usr/bin/caffeinate`) with fixed arguments and no shell.
- No network access. Dev dependencies are pinned. The upstream npm release workflow is disabled in this fork; CI uses SHA-pinned actions with read-only permissions.

### Layout

- `.opencode/plugin/core.ts`: event routing shared by both entries
- `.opencode/plugin/index.ts`: v1 entry
- `.opencode/plugin/v2.ts`: v2 entry (`Plugin.define`)
- `.opencode/plugin/session-manager.ts`, `caffeinate-manager.ts`: session files and process control
- `.opencode/plugin/lock.ts`, `paths.ts`: cross-process lock, secure state directory, input validation

## Development

```bash
bun install
bun run test
bunx tsc --noEmit
```

## License

MIT. Original work © Trong Nguyen; modifications © their respective authors. See upstream for the original.
