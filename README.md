# opencode-caffeinate

Prevent macOS from sleeping while OpenCode is working a turn.

## What it does

This plugin automatically runs `caffeinate -dim` when an OpenCode session starts, keeping your Mac awake during long AI coding sessions. When all sessions end, caffeinate is stopped to restore normal power management.

**Flags used:**
- `-d`: Prevent display sleep
- `-i`: Prevent idle sleep
- `-m`: Prevent disk sleep

## Installation

### From npm (recommended)

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-caffeinate"]
}
```

### From local files

Clone this repo to your plugins directory:

```bash
# Global plugins
git clone https://github.com/nguyenphutrong/opencode-caffeinate.git ~/.config/opencode/plugins/opencode-caffeinate

# Or project-level
git clone https://github.com/nguyenphutrong/opencode-caffeinate.git .opencode/plugins/opencode-caffeinate
```

## Requirements

- **macOS only** - The `caffeinate` command is macOS-specific
- **Bun** >= 1.0.0
- **OpenCode** with plugin support

## How it works

caffeinate runs only while the agent is actively working a turn:

- **Awake**: `session.status` = `busy`/`retry`, or `question.replied` / `permission.replied` (and their `.v2.` variants) (agent resumes).
- **Allowed to sleep**: `session.status` = `idle`, `session.idle`, `question.asked`, `permission.asked`/`permission.updated` (waiting on you), `question.rejected`, `session.error`, `session.deleted`.

Each working session is tracked as a file in `/tmp/opencode-caffeinate/sessions/` (`<pid>_<sessionID>.session`). A single `caffeinate` process (PID in `/tmp/opencode-caffeinate/caffeinate.pid`) is shared across parallel OpenCode instances and stopped when no session is working. Stale sessions from crashed processes are ignored.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Type check
bun run --bun tsc --noEmit
```

## License

MIT
