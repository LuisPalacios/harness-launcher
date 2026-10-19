// Turns raw setting values into validated harness, cwd and terminal settings.
// The glue passes a reader bound to `workspace.getConfiguration("harnessLauncher")`.
import { ArgsParseError, parseArgs } from "./args";
import { isCwdMode, type CwdSettings } from "./cwd";
import { BUILTIN_HARNESSES, type Action } from "./harnesses";

export type SettingsReader = (key: string) => unknown;

/** The subset of `WorkspaceConfiguration.inspect()` the trust guard needs. */
export interface InspectedSetting {
  readonly defaultValue?: unknown;
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

/**
 * In an untrusted workspace, restricted keys come from user settings or the
 * default only. VS Code already filters them for `get()`; enforcing it here as
 * well keeps the guarantee even if that filter ever lets a value through.
 */
export function trustAwareReader(options: {
  readonly read: SettingsReader;
  readonly inspect: (key: string) => InspectedSetting | undefined;
  readonly restricted: ReadonlySet<string>;
  readonly trusted: boolean;
  readonly onIgnored?: (key: string) => void;
}): SettingsReader {
  const { read, inspect, restricted, trusted, onIgnored } = options;
  if (trusted) {
    return read;
  }
  return (key) => {
    if (!restricted.has(key)) {
      return read(key);
    }
    const inspected = inspect(key);
    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      onIgnored?.(key);
    }
    return inspected?.globalValue ?? inspected?.defaultValue;
  };
}

/** Restricted keys from the manifest, relative to the `harnessLauncher` section. */
export function restrictedKeys(packageJson: unknown, section: string): Set<string> {
  const prefix = `${section}.`;
  const list = (packageJson as { capabilities?: { untrustedWorkspaces?: { restrictedConfigurations?: unknown } } } | undefined)
    ?.capabilities?.untrustedWorkspaces?.restrictedConfigurations;
  if (!Array.isArray(list)) {
    return new Set();
  }
  return new Set(
    list.filter((k): k is string => typeof k === "string" && k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
  );
}

export const ENABLED_VALUES = ["auto", "always", "never"] as const;
export type Enabled = (typeof ENABLED_VALUES)[number];

export const TERMINAL_LOCATIONS = ["panel", "editor", "editorBeside"] as const;
export type TerminalLocationSetting = (typeof TERMINAL_LOCATIONS)[number];
/** An editor group beside the current one, so the session sits next to the code. */
export const DEFAULT_TERMINAL_LOCATION: TerminalLocationSetting = "editorBeside";

export interface Harness {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly newArgs: string;
  readonly resumeArgs: string;
  readonly enabled: Enabled;
  readonly source: "builtin" | "custom";
}

export interface Settings<T> {
  readonly value: T;
  readonly errors: readonly string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function readHarnesses(read: SettingsReader): Settings<Harness[]> {
  const errors: string[] = [];
  const byId = new Map<string, Harness>();

  for (const b of BUILTIN_HARNESSES) {
    const enabled = read(`${b.id}.enabled`) ?? "auto";
    if (!oneOf(ENABLED_VALUES, enabled)) {
      errors.push(`harnessLauncher.${b.id}.enabled must be one of ${ENABLED_VALUES.join(", ")}`);
    }
    byId.set(b.id, {
      id: b.id,
      label: b.label,
      command: str(read(`${b.id}.command`), b.command).trim() || b.command,
      newArgs: str(read(`${b.id}.newArgs`), b.newArgs),
      resumeArgs: str(read(`${b.id}.resumeArgs`), b.resumeArgs),
      enabled: oneOf(ENABLED_VALUES, enabled) ? enabled : "auto",
      source: "builtin",
    });
  }

  const custom = read("customHarnesses") ?? [];
  if (!Array.isArray(custom)) {
    errors.push("harnessLauncher.customHarnesses must be an array");
    return { value: [...byId.values()], errors };
  }

  const seen = new Set<string>();
  custom.forEach((entry: unknown, index) => {
    const where = `harnessLauncher.customHarnesses[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const id = e["id"];
    const command = e["command"];
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      errors.push(`${where}.id must be letters, digits, "-" or "_"`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`${where}: id "${id}" appears more than once; the first entry wins`);
      return;
    }
    if (typeof command !== "string" || command.trim() === "") {
      errors.push(`${where}.command must be a non-empty string`);
      return;
    }
    for (const key of ["label", "newArgs", "resumeArgs"]) {
      if (e[key] !== undefined && typeof e[key] !== "string") {
        errors.push(`${where}.${key} must be a string`);
      }
    }
    seen.add(id);
    // A custom entry with a built-in id overrides it; the flat `enabled` setting still applies.
    const builtin = byId.get(id);
    byId.set(id, {
      id,
      label: str(e["label"], builtin?.label ?? id).trim() || id,
      command: command.trim(),
      newArgs: str(e["newArgs"], ""),
      resumeArgs: str(e["resumeArgs"], ""),
      enabled: builtin?.enabled ?? "auto",
      source: "custom",
    });
  });

  return { value: [...byId.values()], errors };
}

export function argsSettingName(harness: Harness, action: Action): string {
  const field = action === "new" ? "newArgs" : "resumeArgs";
  return harness.source === "builtin"
    ? `harnessLauncher.${harness.id}.${field}`
    : `harnessLauncher.customHarnesses (id "${harness.id}") ${field}`;
}

export type CommandLine =
  | { readonly ok: true; readonly executable: string; readonly args: readonly string[] }
  | { readonly ok: false; readonly error: string };

export function commandLineFor(harness: Harness, action: Action): CommandLine {
  const raw = action === "new" ? harness.newArgs : harness.resumeArgs;
  try {
    return { ok: true, executable: harness.command, args: parseArgs(raw) };
  } catch (error) {
    if (error instanceof ArgsParseError) {
      return { ok: false, error: `${argsSettingName(harness, action)}: ${error.message}` };
    }
    throw error;
  }
}

export function readCwdSettings(read: SettingsReader): Settings<CwdSettings> {
  const errors: string[] = [];
  const mode = read("cwd.mode") ?? "workspaceFile";
  if (!isCwdMode(mode)) {
    errors.push(`harnessLauncher.cwd.mode "${String(mode)}" is not a known mode; using workspaceFile`);
  }
  return {
    value: {
      mode: isCwdMode(mode) ? mode : "workspaceFile",
      folderName: str(read("cwd.folderName"), ""),
      path: str(read("cwd.path"), ""),
    },
    errors,
  };
}

export function readTerminalLocation(read: SettingsReader): TerminalLocationSetting {
  const value = read("terminal.location");
  return oneOf(TERMINAL_LOCATIONS, value) ? value : DEFAULT_TERMINAL_LOCATION;
}
