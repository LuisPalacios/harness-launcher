// Keeps package.json settings in sync with src/harnesses.ts and the trust rules.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CWD_MODES } from "../../src/cwd";
import {
  DEFAULT_TERMINAL_LOCATION,
  ENABLED_VALUES,
  QUICK_LAUNCH_NONE,
  restrictedKeys,
  TERMINAL_LOCATIONS,
} from "../../src/config";
import { BUILTIN_HARNESSES } from "../../src/harnesses";

interface Property {
  readonly default?: unknown;
  readonly enum?: readonly string[];
  readonly enumDescriptions?: readonly string[];
  readonly scope?: string;
  readonly markdownDescription?: string;
}

interface Manifest {
  readonly publisher: string;
  readonly name: string;
  readonly activationEvents: readonly string[];
  readonly capabilities: { readonly untrustedWorkspaces: { readonly restrictedConfigurations: readonly string[] } };
  readonly contributes: {
    readonly commands: readonly { readonly command: string }[];
    readonly icons: Readonly<
      Record<string, { readonly default: { readonly fontPath: string; readonly fontCharacter: string } } | undefined>
    >;
    readonly configuration: readonly { readonly properties: Readonly<Record<string, Property>> }[];
  };
}

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")) as Manifest;
const properties: Record<string, Property> = Object.assign({}, ...manifest.contributes.configuration.map((s) => s.properties));
const restricted = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;

function prop(key: string): Property {
  const p = properties[key];
  if (p === undefined) {
    throw new Error(`package.json does not contribute ${key}`);
  }
  return p;
}

describe("package.json", () => {
  test.each(BUILTIN_HARNESSES.map((h) => [h.id, h] as const))("%s settings match the harness table", (_id, h) => {
    const key = `harnessLauncher.${h.id}`;
    expect(prop(`${key}.command`).default).toBe(h.command);
    expect(prop(`${key}.newArgs`).default).toBe(h.newArgs);
    expect(prop(`${key}.continueArgs`).default).toBe(h.continueArgs);
    expect(prop(`${key}.resumeArgs`).default).toBe(h.resumeArgs);
    expect(prop(`${key}.enabled`).enum).toEqual([...ENABLED_VALUES]);
    for (const field of ["command", "newArgs", "continueArgs", "resumeArgs"]) {
      expect(restricted).toContain(`${key}.${field}`);
    }
  });

  test("the runtime guard reads every restricted key from the manifest", () => {
    expect(restrictedKeys(manifest, "harnessLauncher").size).toBe(restricted.length);
  });

  test("execution-deciding settings are restricted in untrusted workspaces", () => {
    expect(restricted).toContain("harnessLauncher.customHarnesses");
    expect(restricted).toContain("harnessLauncher.cwd.path");
    expect(restricted).toContain("harnessLauncher.quickLaunch.harness");
    for (const key of restricted) {
      prop(key);
    }
  });

  test("cwd settings can live in the .code-workspace file", () => {
    for (const key of ["harnessLauncher.cwd.mode", "harnessLauncher.cwd.folderName", "harnessLauncher.cwd.path"]) {
      expect(prop(key).scope).toBe("window");
    }
  });

  test("enums match the code and are described", () => {
    expect(prop("harnessLauncher.cwd.mode").enum).toEqual([...CWD_MODES]);
    expect(prop("harnessLauncher.terminal.location").enum).toEqual([...TERMINAL_LOCATIONS]);
    expect(prop("harnessLauncher.terminal.location").default).toBe(DEFAULT_TERMINAL_LOCATION);
    expect(prop("harnessLauncher.quickLaunch.harness").enum).toEqual([QUICK_LAUNCH_NONE, ...BUILTIN_HARNESSES.map((h) => h.id)]);
    expect(prop("harnessLauncher.quickLaunch.harness").default).toBe(QUICK_LAUNCH_NONE);
    for (const [key, p] of Object.entries(properties)) {
      expect(p.markdownDescription, key).toBeString();
      if (p.enum !== undefined) {
        expect(p.enumDescriptions?.length, key).toBe(p.enum.length);
      }
    }
  });

  test("the status bar button is on by default and activation waits for startup to finish", () => {
    expect(prop("harnessLauncher.statusBar.enabled").default).toBe(true);
    expect(manifest.activationEvents).toEqual(["onStartupFinished"]);
  });

  test("the status bar icon font is contributed, packaged and used", () => {
    const icon = manifest.contributes.icons["harness-launcher-rocket"];
    expect(icon?.default.fontCharacter).toBe("\\E000");
    const fontPath = icon?.default.fontPath ?? "";
    expect(existsSync(join(import.meta.dir, "../..", fontPath))).toBe(true);
    const ignore = readFileSync(join(import.meta.dir, "../../.vscodeignore"), "utf8").split("\n");
    expect(ignore).toContain(`!${fontPath}`);
    const source = readFileSync(join(import.meta.dir, "../../src/extension.ts"), "utf8");
    expect(source).toContain('"$(harness-launcher-rocket)"');
  });

  test("every command the code registers is contributed", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/extension.ts"), "utf8");
    const registered = [...source.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]);
    expect(registered.toSorted()).toEqual(manifest.contributes.commands.map((c) => c.command).toSorted());
  });
});
