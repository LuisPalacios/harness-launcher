// Shell-aware quoting for the sendText fallback, used when shell integration
// does not activate in time. Each argument becomes exactly one shell word.

export type ShellKind = "pwsh" | "cmd" | "posix";

export function shellKindFromPath(shellPath: string): ShellKind {
  const base = shellPath.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, "") ?? "";
  if (base === "pwsh" || base === "powershell" || base === "pwsh-preview") {
    return "pwsh";
  }
  if (base === "cmd") {
    return "cmd";
  }
  return "posix";
}

// Characters that never need quoting in the given shell.
const SAFE: Record<ShellKind, RegExp> = {
  posix: /^[A-Za-z0-9_\-+=.,/:@%]+$/,
  pwsh: /^[A-Za-z0-9_\-+=./:\\]+$/,
  cmd: /^[A-Za-z0-9_\-+=./:\\]+$/,
};

export function quoteArg(kind: ShellKind, arg: string): string {
  if (arg !== "" && SAFE[kind].test(arg)) {
    return arg;
  }
  switch (kind) {
    case "posix":
      return `'${arg.replaceAll("'", `'\\''`)}'`;
    case "pwsh":
      // Single quotes are literal in PowerShell; a quote is doubled.
      return `'${arg.replaceAll("'", "''")}'`;
    case "cmd":
      // Inside double quotes cmd treats & | < > ^ literally. A quote is doubled,
      // which the C runtime argument parser reads back as one quote. cmd still
      // expands %VAR% inside quotes and offers no escape there.
      return `"${arg.replaceAll('"', '""')}"`;
  }
}

export function quoteCommandLine(kind: ShellKind, executable: string, args: readonly string[]): string {
  const exe = quoteArg(kind, executable);
  // PowerShell parses a quoted first word as a string, so it needs the call operator.
  const head = kind === "pwsh" && exe !== executable ? `& ${exe}` : exe;
  return [head, ...args.map((a) => quoteArg(kind, a))].join(" ");
}
