# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-19

First release.

### Added

- Editor title button and **Harness Launcher: Open Launcher** command with a quick pick of detected harnesses, each with **New session** and **Resume session**.
- Built-in harnesses: Claude Code, Codex, Gemini CLI, GitHub Copilot CLI and opencode, plus `customHarnesses` for any other CLI.
- Detection that requires a version number from `<command> --version`, so stub executables do not show up as installed.
- Working-directory modes `workspaceFile` (the hub of a multi-root workspace, the default), `namedFolder`, `firstFolder`, `activeFile`, `pick` and `path`, with a visible fallback.
- Terminal location setting, `editorBeside` by default.
- `harnessLauncher.launch` command for key bindings, plus **Refresh Detection** and **Configure**.
- Workspace Trust support: untrusted workspaces cannot change commands, arguments or paths.
- **Harness Launcher** log output channel with detection results and launches.

[0.1.0]: https://github.com/LuisPalacios/harness-launcher/releases/tag/v0.1.0
