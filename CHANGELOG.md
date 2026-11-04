# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - fork `opencode-caffeinate-turn`

### Changed
- Keep awake only while a turn is running; release on idle, question/permission/form prompts, error, interrupt, delete; resume on reply
- Distributed from GitHub only; upstream npm release workflow disabled

### Added
- OpenCode v2 plugin entry (`v2.ts`) and shared `core.ts`
- Cross-process start/stop lock (fixes concurrent-start race that orphaned `caffeinate` processes)
- Event, v2-entry, security and multi-process race tests

### Security
- Verify PID is the user's own `caffeinate` before signalling; reject negative/group/garbage PIDs
- Per-user `0700` state directory under `$TMPDIR`; refuse symlinked/foreign-owned dirs; `0600` files
- Validate session IDs (no path traversal); absolute `/usr/bin/caffeinate`
- Pin dev dependencies and CI actions; read-only CI permissions

## [0.1.0] - 2025-01-20

### Added
- Initial plugin implementation
- CaffeinateManager class for subprocess management
- Session lifecycle hooks (created, idle, deleted)
- Multiple session support with reference counting
- Structured logging via client.app.log()
- macOS platform detection
