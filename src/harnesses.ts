// Built-in harness table. This is the only place to touch when a CLI changes
// its executable name or its resume flag.

export type Action = "new" | "resume";

export interface HarnessDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly newArgs: string;
  readonly resumeArgs: string;
}

export const BUILTIN_HARNESSES: readonly HarnessDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    newArgs: "",
    // Verified on 2.1.303: `-r, --resume [value]` opens the session picker.
    resumeArgs: "--resume",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    newArgs: "",
    // Verified on codex-cli 0.160.1: `codex resume` opens the picker by default.
    resumeArgs: "resume",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    newArgs: "",
    // Unverified. `--resume` takes `latest`, an index or a session UUID; there is
    // no picker at launch (the picker is `/resume` inside a session).
    // Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md (checked 2026-10-19).
    resumeArgs: "--resume latest",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    command: "copilot",
    newArgs: "",
    // Unverified. Bare `--resume` opens the session picker; `--continue` resumes the latest.
    // Source: https://docs.github.com/en/copilot/reference/cli-command-reference (checked 2026-10-19).
    resumeArgs: "--resume",
  },
  {
    id: "opencode",
    label: "opencode",
    command: "opencode",
    newArgs: "",
    // Unverified. `-c, --continue` continues the last session; there is no picker at
    // launch (`/sessions` inside the TUI lists them).
    // Source: https://opencode.ai/docs/cli/ (checked 2026-10-19).
    resumeArgs: "--continue",
  },
];
