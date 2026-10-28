# CLAUDE.md

This file provides shared guidance to Claude Code and Codex when working in this repository. Resolve repository paths from the repository root, including when reading this file through `AGENTS.md`.

## What this repo is

`harness-launcher` is a VS Code extension. One button in the editor title bar lists the AI coding CLIs ("harnesses") detected on the computer, such as Claude Code and Codex, and opens a terminal that starts a new session or resumes one. Per-harness arguments and the terminal's working directory are configurable, with first-class support for multi-root workspaces ("always start in the hub folder").

The project is public and published to the VS Code Marketplace and Open VSX. TypeScript, bundled with esbuild, tests with Bun and `@vscode/test-cli`.

## Core principles

- **Simplicity first**: make every change as simple as possible. Impact minimal code.
- **No laziness**: find root causes. No temporary fixes. Senior developer standards.
- **Minimal impact**: changes should only touch what's necessary. Avoid introducing bugs.
- **Skills first**: check if a skill exists before manual work.
- **Self-improve**: when a skill fails, update its SKILL.md with the fix.
- **Zero entropy**: never create files outside the defined structure.

## Documentation style

English is the only language of this repository: code, comments, docs, commit messages, UI strings and settings descriptions.

- **First person singular** ("I install", "I use"), unless explaining to others ("Install from the Marketplace").
- **Sentence-case headings**: only capitalize the first word.
- **Hyphens (`-`)** for unordered lists, never asterisks.
- **Language tags** on every fenced code block.
- **Active voice**, direct phrasing, no AI filler ("Let's dive in", "In conclusion").
- **Prose over tables** for concepts; tables only for settings references, CLI references or pure data.
- No passive voice, no long paragraphs, no placeholder TODOs.
- **README images are PNG or GIF.** `vsce package` rejects SVG images in `README.md` unless they come from an approved badge host. The centered header uses `media/harness-launcher.png`. Badges: shields.io retired its VS Marketplace badges, so those come from `vsmarketplacebadges.dev`; everything else uses shields.io or the GitHub Actions badge.

## Repository layout

Keep this section in sync with the real tree.

- `src/`: extension source. Pure modules (argument parser, shell quoting, working-directory resolver, PATH resolver, harness table, keybindings.json writer) never import `vscode`, so Bun can unit-test them. VS Code glue lives in separate files; `src/extension.ts` is the entry point.
- `test/unit/`: Bun unit tests. `test/integration/`: `@vscode/test-cli` tests. `test/fixtures/`: a multi-root fixture workspace. Each test folder has its own `tsconfig.json` (Bun or Mocha globals).
- `media/`: original artwork. `harness-launcher.svg` is the source of the Marketplace icon `harness-launcher.png` (256×256, `magick -background none -density 768 media/harness-launcher.svg -resize 256x256 -depth 8 PNG32:media/harness-launcher.png`). `harness-launcher-toolbar.svg` is the editor title bar button, the same rocket without the tile; keep both SVGs in sync. `harness-launcher-glyph.woff` is the status bar icon: the toolbar rocket as a one-color font glyph (U+E000), because the status bar only draws font icons. Rebuild it with `uv run media/harness-launcher-glyph.py` after changing the toolbar SVG. `demo.gif` is the README demo.
- `esbuild.mjs`: bundles `src/extension.ts` into `dist/extension.js`; `--tests` also bundles the integration suite into `out/test/`.
- `package.json`: manifest, settings contributions and scripts. `tsconfig.json`, `.oxlintrc.json`, `.vscodeignore`: tool config.
- `dist/`, `out/`, `.vscode-test/`: build and test output, ignored by git.
- `.claude/CLAUDE.md`: shared instructions; `.claude/context/`: task-specific guidance; `.claude/rules/`: authoring rules; `.claude/skills/`: canonical skills.
- `AGENTS.md` links to `.claude/CLAUDE.md`; `.agents/skills` links to `../.claude/skills`.
- `.githooks/`: tracked git hooks. `.github/workflows/`: CI and releases.

## Dual Claude / Codex setup

This repo is wired so Claude Code and Codex share one source of truth without duplication. `.claude/CLAUDE.md` is the canonical guidance file. Claude Code reads it directly, and Codex reads `AGENTS.md` at the repo root, which is a symlink back to it. Skills live under `.claude/skills/` and are exposed to Codex through `.agents/skills` (symlink to `../.claude/skills`).

If the symlinks ever go missing or get checked out as plain files, follow the repair procedure in `.claude/context/guideline_codex.md`. On Windows, create them with `mklink` from cmd.exe; Git Bash's `ln -s` produces file copies, not symlinks.

## Shared agent capabilities

- Claude Code uses `/skill-name`; Codex uses `$skill-name` (for example, `$work-issue 12`). Natural-language requests work in both.
- Before creating or changing a skill, read `.claude/rules/skills-authoring.md`. Codex must read it explicitly; Claude's path-scoped rule loading does not apply to Codex. Read `.claude/context/guideline_python.md` or `.claude/context/guideline_js.md` before changing skill scripts in that language. Those zero-footprint conventions apply **only to skill scripts under `.claude/skills/`**; they do not replace the extension's own `package.json` workflow.
- Use the available planning, progress, search, file-reading, image-viewing, and delegation tools. Claude tool names in shared skills describe capabilities, not required Codex tool names. If a tool is unavailable, use the equivalent supported capability; never claim to have called it.
- If the harness cannot enter plan mode itself, write the implementation plan in the conversation before editing. Preserve any explicit user gates in the invoked skill.
- `.claude/settings.json` permissions apply only to Claude Code. Codex follows its own session permissions, sandbox, and approval policy.
- Keep shared, durable project lessons in the relevant canonical instructions, context file, or skill. Use private memory only when the harness provides it; never copy private memory or credentials into the repository.

## Build and test

The skills call these `package.json` scripts by name. Keep the names stable; if one changes, update `.claude/skills/work-issue/SKILL.md` in the same commit.

```bash
bun install                 # dependencies
bun run build               # esbuild bundle into dist/extension.js
bun run typecheck           # tsc --noEmit, strict
bun run lint                # oxlint
bun run test                # Bun unit tests of the pure modules
bun run test:integration    # @vscode/test-cli on the multi-root fixture
bun run package             # vsce package --no-dependencies -> harness-launcher-<version>.vsix
code --install-extension harness-launcher-<version>.vsix --force
```

## Extension rules

- **TypeScript strict, never `any`.** Type the VS Code API surface properly; use `unknown` plus narrowing at boundaries.
- **Pure core, thin glue.** Logic that can be tested without VS Code lives in modules that do not import `vscode`.
- **Settings must be editable in the Settings UI.** The UI cannot edit arrays of objects, so every built-in harness gets flat string settings. Arrays of objects are only for power-user extras edited in `settings.json`.
- **Workspace Trust.** Any setting that decides what gets executed (`command`, arguments, custom harnesses, absolute paths) is listed in `capabilities.untrustedWorkspaces.restrictedConfigurations`.
- **No vendor logos.** Never ship Anthropic, OpenAI, Google or GitHub marks. Use codicons and an original Marketplace icon.
- **Detection needs proof.** Finding an executable on PATH is not enough; a stub can print an error and exit non-zero. Confirm with a `--version` probe with a timeout.
- **Package and reload.** A reinstalled `.vsix` is not picked up by a running VS Code window. Every manual test starts with **Developer: Reload Window** in each open window.
- **Package with `--no-dependencies`.** The bundle has no runtime dependencies, and on the maintainer's Windows machine plain `vsce package` produced an empty file list.
- **Line endings LF, UTF-8 without BOM.** `.gitattributes` enforces it.

## Workflow orchestration

**Priority order when rules conflict**: correctness > simplicity > elegance.

### Feature lifecycle

The backlog lives in GitHub issues on this repository. Features use the `enhancement` label, bugs use `bug`. Flow: open an issue → plan in comments or plan mode → implement → reference the issue in the commit → close on merge. For isolated work per issue, use `/work-issue <N>` and `/merge-pr <PR#>`.

### Push to main vs branch + PR

Default to branch + PR when in doubt.

**Push directly to main** only when all of these hold: one file (or a tightly coupled two-file edit), a mechanically obvious change, typecheck, lint and focused tests pass locally, and no change to settings, commands or `contributes`.

**Branch + PR to self-merge** for everything else. Branch names follow `<type>/<issue>-<slug>`, for example `feat/4-named-folder-mode`. Use `Closes #N` in the PR body.

### Never push without asking first

Local commits are fine. **Any action that makes work visible on GitHub requires the user's explicit go-ahead first**: `git push`, `gh pr create`, `gh pr merge`, `gh release`, tags, and any edit to an issue, PR or comment. No exemptions for doc fixes.

For runtime-affecting changes (`src/`, `package.json`, build config), stop after local verification and send one short message with the commits ready, the `.vsix` path, a concrete check to perform after **Developer: Reload Window**, and the exact publish command intended next (described, not executed). For doc-only changes, one line: "Commit `<sha>` ready. Push directly / open a PR / hold?"

An explicit, in-session "ship on green" for a specific task is the only pre-authorisation. Approval from a previous session does not count.

### Publishing to the stores

Publishing to the Marketplace or Open VSX is irreversible for a given version number. It only happens from the tagged release workflow, after the user's explicit go-ahead for that version. Never publish from a local machine without being asked to.

### 1. Plan first

- Plan before any non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, stop and re-plan immediately.
- Verify the premise in the live system before designing: run the real CLI, read the real setting, open the real workspace. Prefer a control case: if a check comes back suspiciously clean, run it against something you know exists.

### 2. Subagent strategy

- Use subagents to keep the main context clean: research, exploration, parallel analysis.
- One task per subagent.

### 3. Verify before done

- Never mark a task complete without proving it works: typecheck, lint, tests, and a packaged `.vsix` for runtime changes.
- After any command that writes files, read the file on disk; never trust command output alone.

### 4. Autonomous bug fixing

- When given a bug report: just fix it. Point at logs, errors, failing tests, then resolve them.

### 5. Learn from corrections

- After corrections from the user, save a `feedback` memory when available, and record reusable project lessons in this file, a context file or the relevant skill.

## Git commits

- **Never** attribute authorship or co-authorship to any AI model, assistant, agent, or harness, anywhere: commit messages, PR titles, PR descriptions, PR or issue comments, release notes, merge or squash messages, code comments. Never add AI `Co-Authored-By` trailers, AI signatures, or "generated by/with" footers. Before committing or publishing any text, read the final text and remove any such attribution.
- The tracked `.githooks/commit-msg` hook rejects those trailers and footers. Keep it enabled (`git config core.hooksPath .githooks`) and never bypass it with `--no-verify`.
- **Never** modify git config for author or committer. Commits appear as the user's own work.

## GitHub CLI (`gh`) account

This repo is owned by the `LuisPalacios` GitHub account. Before any `gh` command, derive the owner from `remote.origin.url` and switch in the same command:

```bash
gh auth switch --hostname github.com --user LuisPalacios
```

Never assume the active account is correct; it changes between sessions.

## Anonymize before posting to GitHub

Anything published to a GitHub-visible surface (issues, comments, PRs, release notes, pushed commit messages, README screenshots and GIFs) must not contain private details of the maintainer's machine. GitHub keeps edit history; prevention is the only reliable strategy.

Always strip or replace with placeholders:

- Local filesystem paths: `C:\Users\<name>\...`, `/Users/<name>/...`, `/home/<name>/...`, drive-letter clone roots.
- Workstation hostnames, SSH host aliases, IP addresses, email addresses, personal names.
- Names of private repositories, organizations or clients that appear in workspace folders.

Public references to this repository itself (file paths in the repo, issue and PR numbers, commit SHAs, permalinks) are fine. When in doubt, ask before posting.

## Screenshots for debugging

When the user says "I took a screenshot" or "check my screenshot", read the newest file by modification time:

```bash
ls -t "$HOME/Pictures/Screenshots/"*.png | head -1   # Windows
ls -t ~/Desktop/*.png | head -1                      # macOS
```
