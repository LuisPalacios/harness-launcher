import { describe, expect, test } from "bun:test";
import { quoteArg, quoteCommandLine, shellKindFromPath } from "../../src/quote";

describe("shellKindFromPath", () => {
  test.each([
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh"],
    ["C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "pwsh"],
    ["/usr/local/bin/pwsh", "pwsh"],
    ["C:\\WINDOWS\\system32\\cmd.exe", "cmd"],
    ["C:\\Program Files\\Git\\bin\\bash.exe", "posix"],
    ["/bin/zsh", "posix"],
    ["", "posix"],
  ] as const)("%s -> %s", (shell, kind) => {
    expect(shellKindFromPath(shell)).toBe(kind);
  });
});

describe("quoteArg", () => {
  test("leaves safe words alone", () => {
    expect(quoteArg("posix", "--resume")).toBe("--resume");
    expect(quoteArg("pwsh", "--resume")).toBe("--resume");
    expect(quoteArg("cmd", "C:\\tools\\x.exe")).toBe("C:\\tools\\x.exe");
  });

  test("posix uses single quotes and closes them around a quote", () => {
    expect(quoteArg("posix", "a b")).toBe("'a b'");
    expect(quoteArg("posix", "it's")).toBe("'it'\\''s'");
    expect(quoteArg("posix", "$HOME")).toBe("'$HOME'");
    expect(quoteArg("posix", "")).toBe("''");
  });

  test("pwsh doubles single quotes and quotes PowerShell metacharacters", () => {
    expect(quoteArg("pwsh", "it's")).toBe("'it''s'");
    expect(quoteArg("pwsh", "$env:HOME")).toBe("'$env:HOME'");
    expect(quoteArg("pwsh", "a,b")).toBe("'a,b'");
    expect(quoteArg("pwsh", "@splat")).toBe("'@splat'");
    expect(quoteArg("pwsh", "")).toBe("''");
  });

  test("cmd uses double quotes and doubles embedded quotes", () => {
    expect(quoteArg("cmd", "a & b")).toBe('"a & b"');
    expect(quoteArg("cmd", 'say "hi"')).toBe('"say ""hi"""');
    expect(quoteArg("cmd", "")).toBe('""');
  });
});

describe("quoteCommandLine", () => {
  test("plain command", () => {
    expect(quoteCommandLine("pwsh", "claude", ["--resume"])).toBe("claude --resume");
    expect(quoteCommandLine("posix", "codex", ["resume"])).toBe("codex resume");
    expect(quoteCommandLine("cmd", "gemini", [])).toBe("gemini");
  });

  test("pwsh needs the call operator for a quoted executable", () => {
    expect(quoteCommandLine("pwsh", "C:\\Program Files\\x\\x.exe", ["a b"])).toBe("& 'C:\\Program Files\\x\\x.exe' 'a b'");
  });

  test("posix and cmd quote the executable directly", () => {
    expect(quoteCommandLine("posix", "/opt/my tools/x", [])).toBe("'/opt/my tools/x'");
    expect(quoteCommandLine("cmd", "C:\\Program Files\\x.exe", ["--y"])).toBe('"C:\\Program Files\\x.exe" --y');
  });
});
