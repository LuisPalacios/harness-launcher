// Built-in harness table. This is the only place to touch when a CLI changes
// its executable name, its resume flag or its continue flag.

export type Action = "new" | "continue" | "resume";

export const ACTIONS: readonly Action[] = ["new", "continue", "resume"];

export interface HarnessDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly newArgs: string;
  /** Jumps straight into the most recent session. Equal to `resumeArgs` when the CLI has only one way back. */
  readonly continueArgs: string;
  readonly resumeArgs: string;
}

export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    newArgs: "",
    // Verified on 2.1.304: `-c, --continue` continues the most recent conversation.
    continueArgs: "--continue",
    // Verified on 2.1.303: `-r, --resume [value]` opens the session picker.
    resumeArgs: "--resume",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    newArgs: "",
    // Verified on codex-cli 0.160.1: `codex resume --last` continues the most recent session.
    continueArgs: "resume --last",
    // Verified on codex-cli 0.160.1: `codex resume` opens the picker by default.
    resumeArgs: "resume",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    newArgs: "",
    // Verified on 0.38.2: `-r, --resume` takes "latest" or a session index; there is
    // no picker at launch (the picker is `/resume` inside a session). Resume already
    // continues the latest session, so continue is the same command.
    continueArgs: "--resume latest",
    resumeArgs: "--resume latest",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    command: "copilot",
    newArgs: "",
    // Unverified. Bare `--resume` opens the session picker; `--continue` resumes the latest.
    // Source: https://docs.github.com/en/copilot/reference/cli-command-reference (checked 2026-10-19).
    continueArgs: "--continue",
    resumeArgs: "--resume",
  },
  {
    id: "opencode",
    label: "opencode",
    command: "opencode",
    newArgs: "",
    // Unverified. `-c, --continue` continues the last session; there is no picker at
    // launch (`/sessions` inside the TUI lists them), so continue is the same command.
    // Source: https://opencode.ai/docs/cli/ (checked 2026-10-19).
    continueArgs: "--continue",
    resumeArgs: "--continue",
  },
];
