import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Detector,
  probeSpec,
  probeVersion,
  resolveExecutable,
  windowsExtensions,
  type ProbeResult,
  type ResolveOptions,
} from "../../src/detect";

const win = process.platform === "win32";
let root = "";
let bin = "";

// Fake executables: one prints a version, one mimics the "not installed" shim that
// exits 0, one fails, one hangs past the timeout.
const scripts: Record<string, string> = win
  ? {
      "good.cmd": "@echo off\r\necho good-cli 1.2.3\r\n",
      "stub.cmd":
        "@echo off\r\necho Cannot find Example CLI (https://example.com/install)\r\nset /p answer=Install? (y/N)\r\nexit /b 0\r\n",
      "fail.cmd": "@echo off\r\necho broken 9.9.9\r\nexit /b 1\r\n",
      "slow.cmd": "@echo off\r\nping -n 6 127.0.0.1 >nul\r\necho slow 1.0.0\r\n",
      "both.bat": "@echo off\r\necho bat 1.0\r\n",
      "both.cmd": "@echo off\r\necho cmd 1.0\r\n",
      "script.ps1": "Write-Output 'ps-cli 4.5.6'\r\n",
      good: "not runnable on Windows",
    }
  : {
      good: "#!/bin/sh\necho 'good-cli 1.2.3'\n",
      stub: "#!/bin/sh\necho 'Cannot find Example CLI (https://example.com/install)'\nread answer\nexit 0\n",
      fail: "#!/bin/sh\necho 'broken 9.9.9'\nexit 1\n",
      slow: "#!/bin/sh\nsleep 5\necho 'slow 1.0.0'\n",
      noexec: "#!/bin/sh\necho 'noexec 1.0'\n",
    };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "harness-detect-"));
  bin = join(root, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(scripts)) {
    const file = join(bin, name);
    writeFileSync(file, body);
    if (!win) {
      chmodSync(file, name === "noexec" ? 0o644 : 0o755);
    }
  }
});

afterAll(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
  }
});

function opts(path: string, extra: NodeJS.ProcessEnv = {}): ResolveOptions {
  return {
    platform: process.platform,
    env: win ? { Path: path, PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS", ...extra } : { PATH: path, ...extra },
    home: root,
  };
}

function probe(name: string, timeoutMs = 10_000): Promise<ProbeResult> {
  const resolved = resolveExecutable(name, opts(bin));
  if (resolved === undefined) {
    throw new Error(`fixture ${name} did not resolve`);
  }
  return probeVersion(probeSpec(resolved, opts(bin)), { timeoutMs, cwd: root });
}

describe("windowsExtensions", () => {
  test("keeps runnable PATHEXT entries in order and appends .ps1", () => {
    expect(windowsExtensions(".COM;.EXE;.BAT;.CMD;.VBS;.JS")).toEqual([".com", ".exe", ".bat", ".cmd", ".ps1"]);
    expect(windowsExtensions(".PS1;.EXE;.exe")).toEqual([".ps1", ".exe"]);
    expect(windowsExtensions(undefined)).toEqual([".com", ".exe", ".bat", ".cmd", ".ps1"]);
  });
});

describe("resolveExecutable", () => {
  test("finds a command on PATH", () => {
    expect(resolveExecutable("good", opts(`${join(root, "missing")}${win ? ";" : ":"}${bin}`))).toBe(
      join(bin, win ? "good.cmd" : "good"),
    );
  });

  test("returns undefined when the command is nowhere", () => {
    expect(resolveExecutable("absent", opts(bin))).toBeUndefined();
    expect(resolveExecutable("", opts(bin))).toBeUndefined();
  });

  test("accepts an absolute path and skips the search", () => {
    const abs = join(bin, win ? "good" : "good");
    expect(resolveExecutable(abs, opts(""))).toBe(win ? `${abs}.cmd` : abs);
  });

  test("expands ~ in the command", () => {
    expect(resolveExecutable(win ? "~\\bin\\good.cmd" : "~/bin/good", opts(""))).toBe(join(bin, win ? "good.cmd" : "good"));
  });

  test("never searches a relative path with a separator", () => {
    expect(resolveExecutable(win ? "bin\\good" : "bin/good", opts(bin))).toBeUndefined();
  });

  test("skips relative PATH entries", () => {
    const previous = process.cwd();
    process.chdir(root);
    try {
      expect(resolveExecutable("good", opts("bin"))).toBeUndefined();
    } finally {
      process.chdir(previous);
    }
  });

  if (win) {
    test("follows PATHEXT order and ignores extensionless files", () => {
      expect(resolveExecutable("both", opts(bin))).toBe(join(bin, "both.bat"));
      expect(resolveExecutable("both", opts(bin, { PATHEXT: ".CMD;.BAT" }))).toBe(join(bin, "both.cmd"));
      expect(resolveExecutable("script", opts(bin))).toBe(join(bin, "script.ps1"));
    });

    test("reads PATH case-insensitively and accepts quoted entries", () => {
      expect(resolveExecutable("good", { platform: "win32", env: { PATH: `"${bin}"` }, home: root })).toBe(join(bin, "good.cmd"));
    });
  } else {
    test("ignores files without the executable bit", () => {
      expect(resolveExecutable("noexec", opts(bin))).toBeUndefined();
    });
  }
});

describe("probeVersion", () => {
  test("accepts a command that prints a version", async () => {
    expect(await probe("good")).toEqual({ ok: true, version: "good-cli 1.2.3" });
  });

  test("rejects a shim that exits 0 without a version", async () => {
    const r = await probe("stub");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("no version");
  });

  test("rejects a non-zero exit even with a version", async () => {
    expect(await probe("fail")).toEqual({ ok: false, reason: "--version exited with code 1" });
  });

  test("gives up after the timeout", async () => {
    const start = Date.now();
    const r = await probe("slow", 1_000);
    expect(r).toEqual({ ok: false, reason: "--version gave no answer within 1000 ms" });
    expect(Date.now() - start).toBeLessThan(4_000);
  });

  test("reports a spawn failure", async () => {
    const r = await probeVersion({ file: join(root, "nope"), args: [], windowsVerbatimArguments: false }, { timeoutMs: 1_000, cwd: root });
    expect(r.ok).toBe(false);
  });

  if (win) {
    // A cold powershell.exe start can pass Bun's 5 s default (seen on CI runners),
    // so the test outlives probe()'s own 10 s timeout and that timeout decides.
    test("runs .ps1 files through PowerShell", async () => {
      expect(await probe("script")).toEqual({ ok: true, version: "ps-cli 4.5.6" });
    }, 15_000);
  }
});

describe("Detector", () => {
  test("caches per command until cleared", async () => {
    let probes = 0;
    const detector = new Detector({
      resolve: (command) => (command === "absent" ? undefined : `/bin/${command}`),
      probe: async () => {
        probes++;
        return { ok: true, version: "x 1.0" };
      },
    });
    expect(await detector.detect("tool")).toEqual({ found: true, path: "/bin/tool", version: "x 1.0" });
    await detector.detect("tool");
    expect(probes).toBe(1);
    detector.clear();
    await detector.detect("tool");
    expect(probes).toBe(2);
    expect(await detector.detect("absent")).toEqual({ found: false, reason: '"absent" is not on PATH' });
  });

  test("a failed probe keeps the resolved path for diagnostics", async () => {
    const detector = new Detector({ resolve: () => "/bin/stub", probe: async () => ({ ok: false, reason: "no version" }) });
    expect(await detector.detect("stub")).toEqual({ found: false, path: "/bin/stub", reason: "no version" });
  });
});
