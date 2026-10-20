<p align="center">
  <img src="media/harness-launcher.png" width="128" alt="Harness Launcher icon: a terracotta rocket on a dark tile">
</p>

<h1 align="center">Harness Launcher</h1>

<p align="center">
  <strong>One button to start or resume any AI coding CLI, in exactly the folder you choose.</strong><br>
  <em>A VS Code extension built for multi-root workspaces. It only lists the CLIs actually installed on the machine.</em>
</p>

<p align="center">
  <a href="https://github.com/LuisPalacios/harness-launcher/actions/workflows/ci.yml"><img src="https://github.com/LuisPalacios/harness-launcher/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=luispa.harness-launcher"><img src="https://vsmarketplacebadges.dev/version-short/luispa.harness-launcher.svg" alt="VS Marketplace version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=luispa.harness-launcher"><img src="https://vsmarketplacebadges.dev/installs-short/luispa.harness-launcher.svg" alt="VS Marketplace installs" /></a>
  <a href="https://open-vsx.org/extension/luispa/harness-launcher"><img src="https://img.shields.io/open-vsx/v/luispa/harness-launcher" alt="Open VSX version" /></a>
  <a href="https://open-vsx.org/extension/luispa/harness-launcher"><img src="https://img.shields.io/open-vsx/dt/luispa/harness-launcher" alt="Open VSX downloads" /></a>
  <a href="https://github.com/LuisPalacios/harness-launcher/releases/latest"><img src="https://img.shields.io/github/v/release/LuisPalacios/harness-launcher" alt="Latest release" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FLuisPalacios%2Fharness-launcher%2Fmain%2Fpackage.json&query=%24.engines.vscode&label=VS%20Code" alt="Minimum VS Code version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LuisPalacios/harness-launcher" alt="MIT license" /></a>
</p>

One button in the editor title bar starts or resumes an AI coding CLI (a "harness") in a terminal, **in exactly the folder you choose**. It lists only the CLIs actually installed on the machine: Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, opencode, plus any you add.

![The launcher lists the detected harnesses and opens Claude Code in the hub folder of a multi-root workspace](media/demo.gif)

It is built for multi-root workspaces. Picture a hub folder holding a `.code-workspace` file, with several repository clones below it. The launcher starts every session **in the hub, never in one of the clones**, unless you tell it otherwise. Each hub can carry its own rule inside its `.code-workspace` file.

```text
── Claude Code ─────────────────────────────────────────────
  + New session        claude                · ~/work/hub
  ↺ Resume session     claude --resume       · ~/work/hub
── Codex ───────────────────────────────────────────────────
  + New session        codex                 · ~/work/hub
  ↺ Resume session     codex resume          · ~/work/hub
────────────────────────────────────────────────────────────
  ⟳ Refresh detection
  ⚙ Configure…
```

Every line shows the exact command and directory it uses. The terminal opens beside the current editor by default, with your normal shell profile, so your `PATH` and aliases apply.

## Why I built it

I work in VS Code with Claude Code running as a CLI in a terminal docked in the sidebar, instead of the extension's chat view. That way VS Code's own tools stay in the left panel (Explorer, Search, Source Control), and I still work with the harness the way I prefer: in its own terminal interface.

The weak spot is getting back in. When I close VS Code by accident, or the CLI session ends, I have to open a terminal, move to the right folder (the hub, not whichever clone was active), and remember that harness's resume flag. Harness Launcher turns all of that into one click on **Resume session**, in the right folder, with the right arguments, for every harness I use.

This is my setup in the user `settings.json`. Both settings belong to the Claude Code extension, which then runs the CLI in a terminal in the sidebar. Harness Launcher works the same with or without them.

```jsonc
{
  // Claude Code extension: open Claude in the sidebar, as the CLI in a terminal
  "claudeCode.preferredLocation": "sidebar",
  "claudeCode.useTerminal": true
}
```

## Install

Before you start, make sure you have:

- VS Code 1.93 or later, or a compatible editor such as VSCodium or Cursor.
- At least one harness CLI installed and working in a terminal, for example `claude --version` or `codex --version`. The extension launches these CLIs; it does not install them.

Then install the extension in one of these ways:

- **Extensions view (recommended):** press `Ctrl+Shift+X` (`Cmd+Shift+X` on macOS), search for **Harness Launcher**, and click **Install** on the entry with the rocket icon, published by **luispa**.

  <img src="media/harness-install.png" width="487" alt="The Extensions view with Harness Launcher by luispa as the first search result">

- **Command line:**

  ```bash
  code --install-extension luispa.harness-launcher
  ```

- **VSCodium, Cursor and other forks:** the same extension is on [Open VSX](https://open-vsx.org/extension/luispa/harness-launcher), so their Extensions view finds it with the same search.
- **Offline, from a file:** download the `.vsix` from the [latest release](https://github.com/LuisPalacios/harness-launcher/releases/latest), then run **Extensions: Install from VSIX…** from the Command Palette.

To check it worked, open any file: the rocket appears at the right end of the editor tab row. Click it, and the list shows every harness it detected. If a CLI you installed is missing, see [Troubleshooting](#troubleshooting).

The extension activates only when you click the button or run one of its commands, so it adds nothing to VS Code's startup time.

## Use

1. Open any file, so the editor title bar shows.
2. Click the rocket icon at the right end of the tab row. If the row is crowded, it sits in the row's **`…`** menu.
3. Pick **New session** or **Resume session** under a harness.

Run **Harness Launcher: Open Launcher** from the Command Palette to do the same without the mouse.

To bind a key directly to one action, add this to `keybindings.json`:

```json
{
  "key": "ctrl+alt+r",
  "command": "harnessLauncher.launch",
  "args": { "harness": "claude", "action": "resume" }
}
```

`harness` is a harness id from the table below (or a custom one), and `action` is `new` or `resume`.

## Built-in harnesses

| Id         | Name           | Command    | Resume arguments                        | Checked                         |
| ---------- | -------------- | ---------- | --------------------------------------- | ------------------------------- |
| `claude`   | Claude Code    | `claude`   | `--resume` (session picker)             | Verified on 2.1.303             |
| `codex`    | Codex          | `codex`    | `resume` (session picker)               | Verified on 0.160.1 and 0.162.1 |
| `gemini`   | Gemini CLI     | `gemini`   | `--resume latest` (most recent session) | Verified on 0.38.2              |
| `copilot`  | GitHub Copilot | `copilot`  | `--resume` (session picker)             | From the official docs, not run |
| `opencode` | opencode       | `opencode` | `--continue` (last session)             | From the official docs, not run |

New sessions run the bare command. Change any command or argument from the Settings UI.

**Detection.** A harness shows up only when its command is on `PATH` **and** `<command> --version` prints a version number within 3 seconds. Being found on `PATH` is not enough: some editors install a stub named after a CLI that prints "not installed" and exits successfully. To list a harness anyway, set its **Enabled** setting to `always`. After installing a CLI, click **Refresh detection**.

## Settings

Open **Harness Launcher: Configure** or search `@ext:luispa.harness-launcher` in Settings. Every setting below is editable in the Settings UI, except `customHarnesses`.

| Setting                             | Default             | Description                                                                                                                           |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `harnessLauncher.cwd.mode`          | `workspaceFile`     | Where the terminal starts. See [Working directory](#working-directory).                                                               |
| `harnessLauncher.cwd.folderName`    | `""`                | Folder for `namedFolder` mode: the name the Explorer shows, not the folder name on disk.                                              |
| `harnessLauncher.cwd.path`          | `""`                | Absolute path for `path` mode. Supports `~`, `${userHome}`, `${workspaceFileDir}`, `${workspaceFolder}`, `${workspaceFolder:<name>}`. |
| `harnessLauncher.terminal.location` | `editorBeside`      | `editorBeside`, `editor` or `panel`.                                                                                                  |
| `harnessLauncher.<id>.enabled`      | `auto`              | `auto` (when detected), `always` or `never`.                                                                                          |
| `harnessLauncher.<id>.command`      | the CLI name        | Executable name on `PATH`, or an absolute path.                                                                                       |
| `harnessLauncher.<id>.newArgs`      | `""`                | Arguments for **New session**.                                                                                                        |
| `harnessLauncher.<id>.resumeArgs`   | see the table above | Arguments for **Resume session**.                                                                                                     |
| `harnessLauncher.customHarnesses`   | `[]`                | Extra harnesses, edited in `settings.json`.                                                                                           |

Arguments are one string, split like a shell would: separate them with spaces and group with `"double"` or `'single'` quotes. The launcher passes each argument quoted, never as raw shell text.

Add a CLI that is not built in with `customHarnesses`. An entry with a built-in `id` replaces that harness.

```json
"harnessLauncher.customHarnesses": [
  { "id": "aider", "label": "Aider", "command": "aider", "newArgs": "", "resumeArgs": "--restore-chat-history" }
]
```

## Working directory

`harnessLauncher.cwd.mode` decides where every terminal starts:

| Mode            | Directory                                                         |
| --------------- | ----------------------------------------------------------------- |
| `workspaceFile` | The folder that holds the saved `.code-workspace` file: the hub.  |
| `namedFolder`   | The workspace folder whose Explorer name equals `cwd.folderName`. |
| `firstFolder`   | The first workspace folder.                                       |
| `activeFile`    | The workspace folder of the file in the active editor.            |
| `pick`          | Ask each time: the hub or any workspace folder.                   |
| `path`          | The absolute path in `cwd.path`.                                  |

When a mode cannot resolve, for example `workspaceFile` in a single-folder window, the terminal starts in the first workspace folder, then in your home folder. A warning names the mode that failed, once per session.

## Multi-root hubs

**How do I give each hub its own rule?** Open Settings, select the **Workspace** tab, and set `cwd.mode` there. In a multi-root workspace, VS Code stores workspace settings inside the `.code-workspace` file:

```json
{
  "folders": [
    { "name": "API", "path": "api-service" },
    { "name": "Web", "path": "web-app" }
  ],
  "settings": {
    "harnessLauncher.cwd.mode": "namedFolder",
    "harnessLauncher.cwd.folderName": "API"
  }
}
```

**Why does `namedFolder` ignore my folder name?** It matches the `name` the Explorer shows (`API` above), not the folder name on disk (`api-service`). The match is exact and case-sensitive. The warning lists the names it found.

**Why did the terminal start in a clone instead of the hub?** The window was opened as a folder, not from the `.code-workspace` file, or the workspace is untitled. Open it with **File → Open Workspace from File…**, or save it with **File → Save Workspace As…**.

## Workspace Trust

A repository could set `command` or arguments in its own `.vscode/settings.json` and get code run when you click. In an untrusted workspace (Restricted Mode), the launcher ignores workspace-level values of every command, argument and path setting, and uses only your user settings. Working-directory modes and the terminal location still follow the workspace.

## Troubleshooting

- **The button is missing.** Open a file: the button lives in the editor's tab row, which only shows when a file is open.
- **A CLI is not detected.** Open **View → Output** and select **Harness Launcher**. The log shows each detection, the path it resolved and why it was rejected.
- **A CLI installed after VS Code started is not found.** The extension sees the `PATH` VS Code started with. Restart VS Code, then click **Refresh detection**.
- **A `.ps1` command is not detected on Windows.** The probe runs `powershell.exe`, so the PowerShell execution policy applies. Set the harness to `always`, or point `command` at the `.exe`.

## Remote and containers

The extension runs where the workspace lives, so in Remote SSH, WSL or a dev container it detects CLIs and opens terminals on the remote side. I have not tested it remotely yet; reports are welcome.

## Ideas

Not in version 0.1, tracked as possible additions:

- a "continue last session" action next to New and Resume;
- a status bar button;
- per-folder rules;
- a session list read from each CLI's history files.

## Development

```bash
bun install
bun run typecheck && bun run lint && bun run test
bun run test:integration    # VS Code on a multi-root fixture
bun run package             # harness-launcher-<version>.vsix
```

## License

[MIT](LICENSE).
