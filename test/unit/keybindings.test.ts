import { describe, expect, test } from "bun:test";
import { currentShortcut, normalizeShortcut, withShortcut } from "../../src/keybindings";

const FORMAT = { insertSpaces: true, tabSize: 4, eol: "\n" };
const CMD = "harnessLauncher.quickLaunch";

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function bindings(text: string): unknown {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

describe("normalizeShortcut", () => {
  test("lowercases, trims and orders modifiers like VS Code", () => {
    expect(value(normalizeShortcut(" Shift+Alt+L "))).toBe("shift+alt+l");
    expect(value(normalizeShortcut("alt+ctrl+shift+f5"))).toBe("ctrl+shift+alt+f5");
    expect(value(normalizeShortcut("ctrl+k   l"))).toBe("ctrl+k l");
    expect(value(normalizeShortcut("cmd+\\"))).toBe("cmd+\\");
    expect(value(normalizeShortcut("f12"))).toBe("f12");
    expect(value(normalizeShortcut("ctrl+numpad_add"))).toBe("ctrl+numpad_add");
  });

  test("rejects what VS Code would not bind, or what would take over typing", () => {
    for (const bad of ["", "   ", "l", "shift+alt+", "hyper+l", "ctrl+ctrl+l", "ctrl+enterkey", "ctrl+k ctrl+l ctrl+m", "f20"]) {
      expect(normalizeShortcut(bad).ok, bad).toBe(false);
    }
  });
});

describe("withShortcut", () => {
  test("creates the list in an empty file", () => {
    expect(bindings(value(withShortcut("", CMD, "shift+alt+l", FORMAT)))).toEqual([{ key: "shift+alt+l", command: CMD }]);
  });

  test("replaces earlier bindings of the command and keeps comments, removals and other commands", () => {
    const text = [
      "// my key bindings",
      "[",
      '    { "key": "ctrl+alt+r", "command": "harnessLauncher.launch", "args": { "harness": "claude", "action": "resume" } },',
      `    { "key": "shift+alt+l", "command": "${CMD}" },`,
      `    { "key": "ctrl+q", "command": "-${CMD}" },`,
      `    { "key": "ctrl+alt+h", "command": "${CMD}" },`,
      "]",
      "",
    ].join("\n");
    const next = value(withShortcut(text, CMD, "ctrl+k l", FORMAT));
    expect(next.startsWith("// my key bindings\n[")).toBe(true);
    expect(bindings(next.replace(/,(\s*\])/, "$1"))).toEqual([
      { key: "ctrl+alt+r", command: "harnessLauncher.launch", args: { harness: "claude", action: "resume" } },
      { key: "ctrl+q", command: `-${CMD}` },
      { key: "ctrl+k l", command: CMD },
    ]);
  });

  test("refuses a file that is not a list of key bindings", () => {
    expect(withShortcut("{}", CMD, "f5", FORMAT).ok).toBe(false);
    expect(withShortcut("[ { ", CMD, "f5", FORMAT).ok).toBe(false);
  });
});

describe("currentShortcut", () => {
  test("returns the last binding of the command and skips removals and other commands", () => {
    const text = [
      "// my key bindings",
      "[",
      `    { "key": "shift+alt+l", "command": "${CMD}" },`,
      '    { "key": "ctrl+alt+r", "command": "harnessLauncher.launch" },',
      `    { "key": "ctrl+k l", "command": "${CMD}" },`,
      `    { "key": "ctrl+q", "command": "-${CMD}" },`,
      "]",
    ].join("\n");
    expect(currentShortcut(text, CMD)).toBe("ctrl+k l");
  });

  test("returns undefined when nothing binds the command or the file is not a list", () => {
    expect(currentShortcut("", CMD)).toBeUndefined();
    expect(currentShortcut("[]", CMD)).toBeUndefined();
    expect(currentShortcut('{ "key": "ctrl+q" }', CMD)).toBeUndefined();
  });
});
