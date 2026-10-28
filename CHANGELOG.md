# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-28

### Added

- **Harness Launcher: Quick Launch** command (`harnessLauncher.quickLaunch`): starts a **New session** of the `quickLaunch.harness` harness, like a double-click on a rocket, so it can be bound to a key. With the setting at `none`, it warns that quick launch is not configured and offers to open the setting.
- **Set shortcut key** link under the setting, also **Harness Launcher: Set Quick Launch Shortcut Key**: asks for the keys, saves them in `keybindings.json` and adds Quick Launch to `terminal.integrated.commandsToSkipShell`, so the shortcut also works while a terminal has focus.

## [0.3.0] - 2026-10-27

### Added

- `harnessLauncher.quickLaunch.harness`: double-click a rocket button, in the editor tab row or the status bar, to start a **New session** of the chosen harness without the list. A single click still opens the launcher.

### Fixed

- Claude Code, or any CLI, sometimes did not show up on macOS until VS Code restarted. A failed detection is no longer cached for the session, so the next launcher run checks again, and on macOS and Linux a command missing from `PATH` is also looked up in `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. The log now prints the `PATH` the extension sees when a harness is not found.

## [0.2.0] - 2026-10-20

### Added

- **Continue last session** action between **New session** and **Resume session**: it jumps straight into the most recent session, without the CLI's picker. Defaults: Claude Code `--continue`, Codex `resume --last`, GitHub Copilot `--continue`. It is hidden when it would run the same command as New or Resume, as for Gemini CLI and opencode. Set it per harness with `harnessLauncher.<id>.continueArgs`, or with `continueArgs` in a custom harness.
- `harnessLauncher.launch` accepts `"action": "continue"` for key bindings.
- Status bar button with the extension's own rocket that opens the launcher, visible even with no file open. Turn it off with `harnessLauncher.statusBar.enabled`.

### Changed

- The extension now activates after VS Code finishes starting, to show the status bar button. It still looks for CLIs only when you open the launcher.

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

[0.4.0]: https://github.com/LuisPalacios/harness-launcher/releases/tag/v0.4.0
[0.3.0]: https://github.com/LuisPalacios/harness-launcher/releases/tag/v0.3.0
[0.2.0]: https://github.com/LuisPalacios/harness-launcher/releases/tag/v0.2.0
[0.1.0]: https://github.com/LuisPalacios/harness-launcher/releases/tag/v0.1.0
