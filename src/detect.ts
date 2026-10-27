// Harness detection: resolve a command against PATH (PATHEXT on Windows) and the
// usual install folders, then prove it runs with a `--version` probe. Found-on-PATH
// is not proof: a shim can print "not installed" and still exit 0, so the probe
// also requires a version number in stdout.
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import * as nodePath from "node:path";

export interface ResolveOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
}

/** Extensions that can be launched without a file association. */
const WINDOWS_RUNNABLE = [".com", ".exe", ".bat", ".cmd", ".ps1"];

export const VERSION_PATTERN = /\d+\.\d+(?:\.\d+)?/;

/**
 * Searched after PATH on macOS and Linux. VS Code started from the Dock or a
 * desktop launcher can miss PATH entries that only the shell profile adds, while
 * native installers (Claude Code's goes to ~/.local/bin) and Homebrew use these.
 */
export const FALLBACK_DIRS = ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] as const;

export function windowsExtensions(pathext: string | undefined): string[] {
  const listed = (pathext ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => WINDOWS_RUNNABLE.includes(e));
  const unique = [...new Set(listed)];
  // PowerShell runs .ps1 files from PATH even though PATHEXT rarely lists them.
  if (!unique.includes(".ps1")) {
    unique.push(".ps1");
  }
  return unique;
}

function getEnv(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }
  // Windows variable names are case-insensitive (PATH vs Path).
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Returns the absolute path that `command` runs, or undefined. Absolute paths
 * (and `~/…`) skip the search. Relative paths with a separator and relative
 * PATH entries are ignored, so a workspace cannot plant an executable. Outside
 * Windows, FALLBACK_DIRS are searched after PATH.
 */
export function resolveExecutable(command: string, opts: ResolveOptions): string | undefined {
  const win = opts.platform === "win32";
  const path = win ? nodePath.win32 : nodePath.posix;
  let cmd = command.trim();
  if (cmd === "") {
    return undefined;
  }
  if (cmd === "~" || cmd.startsWith("~/") || (win && cmd.startsWith("~\\"))) {
    cmd = opts.home + cmd.slice(1);
  }

  const exts = win ? windowsExtensions(getEnv(opts.env, "PATHEXT", opts.platform)) : [];
  if (path.isAbsolute(cmd)) {
    return findFile(cmd, exts, win);
  }
  if (cmd.includes("/") || (win && cmd.includes("\\"))) {
    return undefined;
  }

  const entries = (getEnv(opts.env, "PATH", opts.platform) ?? "").split(path.delimiter);
  if (!win) {
    entries.push(...FALLBACK_DIRS.map((d) => d.replace(/^~/, opts.home)));
  }
  for (const entry of entries) {
    const dir = win ? entry.trim().replace(/^"(.*)"$/, "$1") : entry;
    if (dir === "" || !path.isAbsolute(dir)) {
      continue;
    }
    const found = findFile(path.join(dir, cmd), exts, win);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function findFile(base: string, exts: readonly string[], win: boolean): string | undefined {
  if (!win) {
    return isExecutableFile(base, false) ? base : undefined;
  }
  // An extensionless file is not runnable on Windows, so only PATHEXT candidates count.
  const ext = nodePath.win32.extname(base).toLowerCase();
  const candidates = exts.includes(ext) ? [base] : exts.map((e) => base + e);
  return candidates.find((c) => isExecutableFile(c, true));
}

function isExecutableFile(file: string, win: boolean): boolean {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    if (!win) {
      accessSync(file, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export interface ProbeSpec {
  readonly file: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
}

/** How to run `<resolved> --version` without a shell. */
export function probeSpec(resolved: string, opts: Pick<ResolveOptions, "platform" | "env">): ProbeSpec {
  if (opts.platform === "win32") {
    const ext = nodePath.win32.extname(resolved).toLowerCase();
    if (ext === ".bat" || ext === ".cmd") {
      // Node refuses to spawn batch files directly. The path is quoted and the
      // only argument is fixed, so no setting value reaches cmd's parser.
      const comspec = getEnv(opts.env, "ComSpec", opts.platform) ?? "cmd.exe";
      return { file: comspec, args: ["/d", "/s", "/c", `""${resolved}" --version"`], windowsVerbatimArguments: true };
    }
    if (ext === ".ps1") {
      return {
        file: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", resolved, "--version"],
        windowsVerbatimArguments: false,
      };
    }
  }
  return { file: resolved, args: ["--version"], windowsVerbatimArguments: false };
}

export type ProbeResult = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: string };

export interface ProbeOptions {
  readonly timeoutMs: number;
  readonly cwd: string;
}

const MAX_OUTPUT = 64 * 1024;
const KILL_GRACE_MS = 2000;

/** Runs the probe with stdin closed, so an interactive shim cannot wait for input. */
export function probeVersion(spec: ProbeSpec, opts: ProbeOptions): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ProbeResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(spec.file, [...spec.args], {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
        // A process group on POSIX, so a timeout can kill wrapper scripts and their children.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      finish({ ok: false, reason: errorMessage(error) });
      return;
    }

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk;
      }
    });
    child.stderr?.resume();

    const timeout: ProbeResult = { ok: false, reason: `--version gave no answer within ${opts.timeoutMs} ms` };
    let timedOut = false;
    timer = setTimeout(() => {
      // Report only once the tree is gone ("close" fires when every process holding
      // the pipes has exited), so nothing outlives the probe. The cap covers a
      // process that cannot be killed.
      timedOut = true;
      killTree(child);
      timer = setTimeout(() => finish(timeout), KILL_GRACE_MS);
    }, opts.timeoutMs);

    child.on("error", (error) => finish({ ok: false, reason: error.message }));
    child.on("close", (code) => {
      if (timedOut) {
        finish(timeout);
        return;
      }
      if (code !== 0) {
        finish({ ok: false, reason: `--version exited with code ${code ?? "null"}` });
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => VERSION_PATTERN.test(l));
      if (line === undefined) {
        const first = stdout.trim().split(/\r?\n/)[0] ?? "";
        finish({ ok: false, reason: first === "" ? "--version printed nothing" : `--version printed no version: "${first}"` });
        return;
      }
      finish({ ok: true, version: line.slice(0, 80) });
    });
  });
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // cmd.exe and powershell.exe wrappers leave grandchildren behind a plain kill.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface Detection {
  readonly found: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly reason?: string;
}

export interface DetectorDeps {
  readonly resolve: (command: string) => string | undefined;
  readonly probe: (resolved: string) => Promise<ProbeResult>;
}

/**
 * Caches one successful detection per command string for the session. A failure
 * is not cached, so the next launcher run checks again instead of hiding the
 * harness until Refresh or a restart.
 */
export class Detector {
  private readonly cache = new Map<string, Promise<Detection>>();

  constructor(private readonly deps: DetectorDeps) {}

  detect(command: string): Promise<Detection> {
    const cached = this.cache.get(command);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.run(command);
    this.cache.set(command, pending);
    void pending.then((d) => {
      if (!d.found && this.cache.get(command) === pending) {
        this.cache.delete(command);
      }
    });
    return pending;
  }

  clear(): void {
    this.cache.clear();
  }

  private async run(command: string): Promise<Detection> {
    const resolved = this.deps.resolve(command);
    if (resolved === undefined) {
      return { found: false, reason: `"${command}" is not on PATH` };
    }
    const probe = await this.deps.probe(resolved);
    return probe.ok
      ? { found: true, path: resolved, version: probe.version }
      : { found: false, path: resolved, reason: probe.reason };
  }
}

export function createDetector(opts: ResolveOptions & { readonly timeoutMs: number }): Detector {
  return new Detector({
    resolve: (command) => resolveExecutable(command, opts),
    probe: (resolved) => probeVersion(probeSpec(resolved, opts), { timeoutMs: opts.timeoutMs, cwd: opts.home }),
  });
}
