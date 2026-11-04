# opencode-caffeinate-turn

Keep your Mac awake **only while OpenCode is actively working a turn**.

When the turn finishes, or OpenCode stops to ask you a question or for a permission, the wake lock is released and macOS can sleep normally. When you answer, the lock is taken again.

> **Not published to npm.** Install from this GitHub repository (see [Installation](#installation)). The package name `opencode-caffeinate` on npm is the upstream project, not this fork.

## Contents

- [Based on upstream](#based-on-upstream)
- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Installation](#installation)
- [Verify it works](#verify-it-works)
- [Updating and uninstalling](#updating-and-uninstalling)
- [How it works](#how-it-works)
- [Security](#security)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project layout](#project-layout)
- [License](#license)

## Based on upstream

This is a fork of [nguyenphutrong/opencode-caffeinate](https://github.com/nguyenphutrong/opencode-caffeinate) (MIT, © Trong Nguyen), forked from `v0.1.3` (commit `ebc9c5c`).

| | Upstream | This fork |
|---|---|---|
| Starts `caffeinate` | when a session is created | when the agent starts working (`busy`/`retry`) |
| Stops `caffeinate` | when the session goes idle or is deleted | turn ends, a question/permission/form prompt appears, error, interrupt or delete |
| Resumes after you answer | no | yes (`question`/`permission`/`form` replied) |
| OpenCode v2 plugin API | not loadable (no `Plugin.define` default export) | supported via `v2.ts` |
| Many instances starting at once | each can spawn its own `caffeinate` (race) | one shared `caffeinate`, guarded by a lock |
| PID / path handling | PID file trusted; `/tmp` paths; unvalidated session IDs | verified, per-user `0700` directory, validated IDs (see [Security](#security)) |
| Distribution | npm | GitHub only |
| Tests | session and caffeinate managers | plus event routing, v2 entry, security and multi-process race |

## What it does

While a turn is running it keeps `caffeinate -dim` alive:

- `-d`: prevent display sleep
- `-i`: prevent idle sleep
- `-m`: prevent disk sleep

It is released whenever OpenCode is waiting on you or has finished.

Several OpenCode instances (and several sessions in one instance) share **one** `caffeinate` process. The Mac stays awake while *any* session is mid-turn and may sleep only when *all* are idle or waiting on you.

## Requirements

- macOS (uses `/usr/bin/caffeinate`; the plugin disables itself on other platforms)
- OpenCode with plugin support. Developed and tested against **OpenCode v2.0.28**.
- `git` to clone the repo
- [Bun](https://bun.sh) >= 1.0.0, only for running the tests or developing. It is **not** needed to run the plugin, because OpenCode provides the runtime and `@opencode/plugin`.

## Installation

Installation is from this repository, not from npm.

### OpenCode v2 (tested)

v2 requires a default export built with `Plugin.define`. That is `.opencode/plugin/v2.ts`.

1. Clone the repo:

   ```bash
   git clone https://github.com/notsatyarth/opencode-caffeinate-turn.git \
     ~/.config/opencode/opencode-caffeinate-turn
   ```

2. Create `~/.config/opencode/plugins/caffeinate.ts` (global), or `.opencode/plugins/caffeinate.ts` inside a project (project only), containing a single line. Use an absolute path:

   ```ts
   export { default } from "/Users/<you>/.config/opencode/opencode-caffeinate-turn/.opencode/plugin/v2.ts"
   ```

   Or generate it for the current user:

   ```bash
   echo "export { default } from \"$HOME/.config/opencode/opencode-caffeinate-turn/.opencode/plugin/v2.ts\"" \
     > ~/.config/opencode/plugins/caffeinate.ts
   ```

3. Restart OpenCode (including any background `opencode serve` service).

No `bun install` is required to run it.

### OpenCode v1 (untested)

The v1 entry is `.opencode/plugin/index.ts` (a plain `Plugin` function). It is covered by unit tests, but I have not run it in a live v1 OpenCode, and v2 rejects it. Clone the repo as above and either:

- add the repo to `opencode.json`:

  ```json
  {
    "$schema": "https://opencode.ai/config.json",
    "plugin": ["github:notsatyarth/opencode-caffeinate-turn"]
  }
  ```

- or clone it under `~/.config/opencode/plugins/`.

## Verify it works

In a second terminal, while the agent is running a turn:

```bash
pgrep -fl caffeinate                       # -> /usr/bin/caffeinate -dim
pmset -g assertions | grep -i caffeinate   # -> PreventUserIdleSystemSleep ... caffeinate
```

| What you do | Expected |
|---|---|
| Sit idle at the prompt | no `caffeinate` process |
| Send a long prompt (for example, a bash `sleep 20`) | `caffeinate` appears |
| Turn finishes | `caffeinate` disappears |
| Ask it to use the question tool and leave it unanswered | `caffeinate` disappears while the question is open |
| Answer the question | `caffeinate` comes back, then goes away at the end of the turn |
| Press Esc to abort a turn | `caffeinate` disappears |
| Two OpenCode instances working at once | still exactly one `caffeinate`; it stays until both finish |

Note: if a turn is in progress while you check (including the one in which you ask the agent to check), `caffeinate` is expected to be running.

## Updating and uninstalling

Update:

```bash
git -C ~/.config/opencode/opencode-caffeinate-turn pull
```

then restart OpenCode.

Uninstall:

```bash
rm ~/.config/opencode/plugins/caffeinate.ts
rm -rf ~/.config/opencode/opencode-caffeinate-turn
pkill -x caffeinate    # only if one is left running
```

## How it works

The plugin listens to OpenCode events and keeps a per-session "working" flag.

- **Awake:** `session.status` = `busy`/`retry`; `question.replied`, `permission.replied` (and their `.v2.` variants), `form.replied`, `session.execution.started`.
- **Allowed to sleep:** `session.status` = `idle`, `session.idle`; `question.asked`, `permission.asked`/`permission.updated` (waiting on you); `form.created`/`form.cancelled`; `session.execution.succeeded`/`failed`/`interrupted`; `question.rejected`; `session.error`; `session.deleted`.

OpenCode v2 reports questions as `form.*` events. The older `question.*` and `permission.*` names are still handled for v1 and v2 variants.

State is kept in `$TMPDIR/opencode-caffeinate-<uid>/`:

| File | Purpose |
|---|---|
| `sessions/<pid>_<sessionID>.session` | one empty file per working session |
| `caffeinate.pid` | PID of the single shared `caffeinate` process |
| `state.lock` | cross-process lock for start/stop decisions |

On a start event the plugin registers its session file and spawns `caffeinate` only if none is running. On a stop event it removes its file and kills `caffeinate` only if no live session files remain. Session files whose OpenCode process has died are ignored, so a crashed instance cannot keep the Mac awake. The plugin also releases its sessions when it is disposed.

Start/stop decisions run under a lock (`state.lock`, created with `O_EXCL`; locks from dead or hung owners are reclaimed after 10 s). Without it, N instances starting at once would spawn N `caffeinate` processes, and all but one would be orphaned. With it, exactly one is spawned. This is covered by a multi-process test.

## Security

- **State directory:** per-user, mode `0700`, under `$TMPDIR` (not a shared `/tmp` path). Symlinked or foreign-owned directories are refused. Files are `0600`.
- **PID file:** never trusted blindly. Only plain integers greater than 1 are accepted. Before signalling, the PID is verified (via `/bin/ps`) to be a `caffeinate` process owned by the current user. Negative or group PIDs are rejected, so a stale or poisoned file cannot make the plugin kill an unrelated process.
- **Session IDs:** must match `^[A-Za-z0-9_-]{1,128}$`; anything else is ignored, so there is no path traversal in file names.
- **Process launch:** `/usr/bin/caffeinate` by absolute path, fixed arguments, no shell.
- **No network access**, no `eval`, no secrets.
- **Supply chain:** dev dependencies are pinned; CI uses SHA-pinned actions with read-only permissions; the upstream npm release workflow is disabled in this fork.

A same-user attacker who can already run code as you is out of scope.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_CAFFEINATE_DIR` | `$TMPDIR/opencode-caffeinate-<uid>` | Override the state directory |

The `caffeinate` flags (`-dim`) are currently fixed in `caffeinate-manager.ts`. Change `-dim` to `-i` there if you only want to prevent idle sleep and let the display turn off.

## Troubleshooting

- **`caffeinate` is running while OpenCode is idle.** Check whether a turn is actually running (including background `opencode serve` sessions). If it is stuck: `pkill -x caffeinate && rm -rf "$TMPDIR"/opencode-caffeinate-*`.
- **Plugin does not load.** Look in `~/.local/share/opencode/log/*.log` for `failed to load plugin`. On OpenCode v2 the file must have a default export from `Plugin.define` (use `v2.ts`, not `index.ts`).
- **Nothing happens.** Confirm the path in `plugins/caffeinate.ts` is absolute and points at `v2.ts`, then restart OpenCode and any background service.
- **Not on macOS.** The plugin logs "disabled: only available on macOS" and does nothing.

## Development

```bash
bun install
bun run test            # 59 tests
bunx tsc --noEmit
```

The suite includes unit tests for each manager, event routing (v1 and v2 names), the v2 entry via a fake event stream, the security cases above, and a multi-process race test that spawns real `caffeinate` processes.

## Project layout

- `.opencode/plugin/core.ts`: event routing and lock-guarded start/stop, shared by both entries
- `.opencode/plugin/v2.ts`: v2 entry (`Plugin.define`)
- `.opencode/plugin/index.ts`: v1 entry
- `.opencode/plugin/session-manager.ts`, `caffeinate-manager.ts`: session files and process control
- `.opencode/plugin/lock.ts`, `paths.ts`: cross-process lock, secure state directory, input validation
- `.opencode/plugin/__tests__/`: tests

## License

MIT. Original work © Trong Nguyen ([upstream](https://github.com/nguyenphutrong/opencode-caffeinate)); modifications © notsatyarth. See [package.json](package.json).
