import { describe, expect, test } from "bun:test";
import {
  commandLineFor,
  offersContinue,
  readCwdSettings,
  readHarnesses,
  readQuickLaunch,
  readStatusBarEnabled,
  readTerminalLocation,
  restrictedKeys,
  trustAwareReader,
  type InspectedSetting,
  type SettingsReader,
} from "../../src/config";
import { BUILTIN_HARNESSES } from "../../src/harnesses";

function reader(values: Record<string, unknown>): SettingsReader {
  return (key) => values[key];
}

describe("readHarnesses", () => {
  test("defaults give every built-in harness", () => {
    const { value, errors } = readHarnesses(reader({}));
    expect(errors).toEqual([]);
    expect(value.map((h) => h.id)).toEqual(BUILTIN_HARNESSES.map((b) => b.id));
    expect(value.find((h) => h.id === "claude")).toMatchObject({ command: "claude", resumeArgs: "--resume", enabled: "auto" });
  });

  test("flat settings override built-in fields", () => {
    const { value } = readHarnesses(
      reader({ "claude.command": "claude-dev", "claude.resumeArgs": "--continue", "codex.enabled": "never" }),
    );
    expect(value.find((h) => h.id === "claude")).toMatchObject({ command: "claude-dev", resumeArgs: "--continue" });
    expect(value.find((h) => h.id === "codex")?.enabled).toBe("never");
  });

  test("an empty command falls back to the default", () => {
    const { value } = readHarnesses(reader({ "claude.command": "  " }));
    expect(value.find((h) => h.id === "claude")?.command).toBe("claude");
  });

  test("an invalid enabled value is reported", () => {
    const { value, errors } = readHarnesses(reader({ "gemini.enabled": "sometimes" }));
    expect(value.find((h) => h.id === "gemini")?.enabled).toBe("auto");
    expect(errors[0]).toContain("harnessLauncher.gemini.enabled");
  });

  test("custom harnesses are appended", () => {
    const { value, errors } = readHarnesses(
      reader({ customHarnesses: [{ id: "aider", label: "Aider", command: "aider", resumeArgs: "--restore-chat-history" }] }),
    );
    expect(errors).toEqual([]);
    expect(value.at(-1)).toEqual({
      id: "aider",
      label: "Aider",
      command: "aider",
      newArgs: "",
      continueArgs: undefined,
      resumeArgs: "--restore-chat-history",
      enabled: "auto",
      source: "custom",
    });
  });

  test("built-ins carry their continue arguments", () => {
    const { value } = readHarnesses(reader({ "codex.continueArgs": "resume --last --all" }));
    expect(value.find((h) => h.id === "claude")?.continueArgs).toBe("--continue");
    expect(value.find((h) => h.id === "codex")?.continueArgs).toBe("resume --last --all");
  });

  test("a custom entry keeps continueArgs only when it sets one", () => {
    const { value, errors } = readHarnesses(
      reader({
        customHarnesses: [
          { id: "with", command: "w", continueArgs: "--last" },
          { id: "typed", command: "t", continueArgs: 1 },
        ],
      }),
    );
    expect(errors).toEqual(["harnessLauncher.customHarnesses[1].continueArgs must be a string"]);
    expect(value.find((h) => h.id === "with")?.continueArgs).toBe("--last");
    expect(value.find((h) => h.id === "typed")?.continueArgs).toBeUndefined();
  });

  test("a custom entry with a built-in id overrides it and keeps its enabled setting", () => {
    const { value } = readHarnesses(
      reader({ "claude.enabled": "always", customHarnesses: [{ id: "claude", command: "/opt/claude/bin/claude", newArgs: "--verbose" }] }),
    );
    const claude = value.filter((h) => h.id === "claude");
    expect(claude).toHaveLength(1);
    expect(claude[0]).toMatchObject({ label: "Claude Code", command: "/opt/claude/bin/claude", newArgs: "--verbose", resumeArgs: "", enabled: "always", source: "custom" });
  });

  test("invalid custom entries are skipped with errors", () => {
    const { value, errors } = readHarnesses(
      reader({
        customHarnesses: [
          "nope",
          { id: "bad id", command: "x" },
          { id: "nocmd" },
          { id: "dup", command: "a" },
          { id: "dup", command: "b" },
          { id: "typed", command: "t", newArgs: 3 },
        ],
      }),
    );
    expect(errors).toHaveLength(5);
    expect(value.filter((h) => h.source === "custom").map((h) => [h.id, h.command])).toEqual([
      ["dup", "a"],
      ["typed", "t"],
    ]);
  });

  test("a non-array customHarnesses is reported", () => {
    expect(readHarnesses(reader({ customHarnesses: {} })).errors).toEqual(["harnessLauncher.customHarnesses must be an array"]);
  });
});

describe("commandLineFor", () => {
  const harnesses = readHarnesses(reader({ "claude.newArgs": '--model "x y"', "codex.resumeArgs": '"open' })).value;
  const claude = harnesses.find((h) => h.id === "claude");
  const codex = harnesses.find((h) => h.id === "codex");
  if (claude === undefined || codex === undefined) {
    throw new Error("built-ins missing");
  }

  test("parses the action's arguments", () => {
    expect(commandLineFor(claude, "new")).toEqual({ ok: true, executable: "claude", args: ["--model", "x y"] });
    expect(commandLineFor(claude, "resume")).toEqual({ ok: true, executable: "claude", args: ["--resume"] });
  });

  test("a parse error names the setting", () => {
    const r = commandLineFor(codex, "resume");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toStartWith("harnessLauncher.codex.resumeArgs: unterminated double quote");
  });

  test("continue uses continueArgs", () => {
    expect(commandLineFor(codex, "continue")).toEqual({ ok: true, executable: "codex", args: ["resume", "--last"] });
  });

  test("a custom harness without continueArgs cannot continue", () => {
    const custom = readHarnesses(reader({ customHarnesses: [{ id: "aider", command: "aider" }] })).value.at(-1);
    if (custom === undefined) {
      throw new Error("custom harness missing");
    }
    const r = commandLineFor(custom, "continue");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("continueArgs is not set");
  });
});

function offers(values: Record<string, unknown>): Record<string, boolean> {
  return Object.fromEntries(readHarnesses(reader(values)).value.map((h) => [h.id, offersContinue(h)]));
}

describe("offersContinue", () => {
  test("only when continue differs from new and resume", () => {
    expect(offers({})).toEqual({ claude: true, codex: true, gemini: false, copilot: true, opencode: false });
  });

  test("matching resume or new, or no continueArgs, hides it", () => {
    expect(
      offers({
        "claude.continueArgs": " --resume ",
        "codex.continueArgs": "",
        customHarnesses: [{ id: "aider", command: "aider" }],
      }),
    ).toMatchObject({ claude: false, codex: false, aider: false });
  });

  test("an unparsable continue line is offered so its error shows", () => {
    expect(offers({ "claude.continueArgs": '"open' }).claude).toBe(true);
  });
});

describe("readStatusBarEnabled", () => {
  test("on unless explicitly false", () => {
    expect(readStatusBarEnabled(reader({}))).toBe(true);
    expect(readStatusBarEnabled(reader({ "statusBar.enabled": false }))).toBe(false);
    expect(readStatusBarEnabled(reader({ "statusBar.enabled": "no" }))).toBe(true);
  });
});

describe("readQuickLaunch", () => {
  test("a harness id, or undefined for none and invalid values", () => {
    expect(readQuickLaunch(reader({}))).toBeUndefined();
    expect(readQuickLaunch(reader({ "quickLaunch.harness": "none" }))).toBeUndefined();
    expect(readQuickLaunch(reader({ "quickLaunch.harness": "claude" }))).toBe("claude");
    expect(readQuickLaunch(reader({ "quickLaunch.harness": "my-cli" }))).toBe("my-cli");
    expect(readQuickLaunch(reader({ "quickLaunch.harness": "" }))).toBeUndefined();
    expect(readQuickLaunch(reader({ "quickLaunch.harness": 1 }))).toBeUndefined();
  });
});

describe("readCwdSettings and readTerminalLocation", () => {
  test("defaults", () => {
    expect(readCwdSettings(reader({}))).toEqual({ value: { mode: "workspaceFile", folderName: "", path: "" }, errors: [] });
    expect(readTerminalLocation(reader({}))).toBe("editorBeside");
  });

  test("valid values pass through", () => {
    expect(readCwdSettings(reader({ "cwd.mode": "namedFolder", "cwd.folderName": "hub" })).value).toMatchObject({
      mode: "namedFolder",
      folderName: "hub",
    });
    expect(readTerminalLocation(reader({ "terminal.location": "panel" }))).toBe("panel");
  });

  test("unknown values fall back", () => {
    expect(readCwdSettings(reader({ "cwd.mode": "everywhere" })).errors[0]).toContain("everywhere");
    expect(readTerminalLocation(reader({ "terminal.location": "floating" }))).toBe("editorBeside");
  });
});

describe("trustAwareReader", () => {
  // A get() that lets workspace values through, as if VS Code's own filter failed.
  const inspected: Record<string, InspectedSetting> = {
    "claude.command": { defaultValue: "claude", workspaceFolderValue: "echo" },
    "claude.newArgs": { defaultValue: "", globalValue: "--verbose", workspaceValue: "pwned" },
    "cwd.mode": { defaultValue: "workspaceFile", workspaceValue: "namedFolder" },
  };
  const merged: Record<string, unknown> = { "claude.command": "echo", "claude.newArgs": "pwned", "cwd.mode": "namedFolder" };
  const restricted = new Set(["claude.command", "claude.newArgs"]);

  function build(trusted: boolean, ignored: string[] = []): SettingsReader {
    return trustAwareReader({
      read: (key) => merged[key],
      inspect: (key) => inspected[key],
      restricted,
      trusted,
      onIgnored: (key) => ignored.push(key),
    });
  }

  test("a trusted workspace reads merged values", () => {
    const read = build(true);
    expect(read("claude.command")).toBe("echo");
    expect(read("claude.newArgs")).toBe("pwned");
  });

  test("an untrusted workspace reads restricted keys from user settings or the default", () => {
    const ignored: string[] = [];
    const read = build(false, ignored);
    expect(read("claude.command")).toBe("claude");
    expect(read("claude.newArgs")).toBe("--verbose");
    expect(ignored).toEqual(["claude.command", "claude.newArgs"]);
  });

  test("unrestricted keys keep their workspace value", () => {
    expect(build(false)("cwd.mode")).toBe("namedFolder");
  });

  test("the guard makes a workspace command invisible to readHarnesses", () => {
    const claude = readHarnesses(build(false)).value.find((h) => h.id === "claude");
    expect(claude).toMatchObject({ command: "claude", newArgs: "--verbose" });
  });
});

describe("restrictedKeys", () => {
  test("reads the manifest list relative to the section", () => {
    const pkg = {
      capabilities: {
        untrustedWorkspaces: { restrictedConfigurations: ["harnessLauncher.claude.command", "other.key", 3, "harnessLauncher.cwd.path"] },
      },
    };
    expect([...restrictedKeys(pkg, "harnessLauncher")]).toEqual(["claude.command", "cwd.path"]);
  });

  test("a manifest without the list gives an empty set", () => {
    expect(restrictedKeys({}, "harnessLauncher").size).toBe(0);
    expect(restrictedKeys(undefined, "harnessLauncher").size).toBe(0);
  });
});
