// Runs inside VS Code on the copied multi-root fixture (see .vscode-test.mjs).
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import type { HarnessLauncherApi } from "../../src/extension";

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { publisher: string; name: string };
const extensionId = `${manifest.publisher}.${manifest.name}`;

const { Global, Workspace } = vscode.ConfigurationTarget;
const CWD_KEYS = ["cwd.mode", "cwd.folderName", "cwd.path"];

let api: HarnessLauncherApi;
let hubDir = "";
let alpha = "";
let beta = "";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("harnessLauncher");
}

async function set(values: Record<string, unknown>, target: vscode.ConfigurationTarget = Workspace): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await config().update(key, value, target);
  }
}

async function clear(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await config().update(key, undefined, Workspace);
    await config().update(key, undefined, Global);
  }
}

function resolvedPath(): string {
  const r = api.resolveCwd();
  assert.equal(r.kind, "resolved");
  return r.kind === "resolved" ? r.path : "";
}

function workspaceFileSettings(): Record<string, unknown> {
  const file = vscode.workspace.workspaceFile;
  assert.ok(file);
  const parsed = JSON.parse(readFileSync(file.fsPath, "utf8")) as { settings?: Record<string, unknown> };
  return parsed.settings ?? {};
}

describe("multi-root hub fixture", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension<HarnessLauncherApi>(extensionId);
    assert.ok(extension, `extension ${extensionId} is not loaded`);
    api = await extension.activate();

    const file = vscode.workspace.workspaceFile;
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(file, "the test window must open hub.code-workspace");
    assert.equal(file.scheme, "file");
    assert.deepEqual(
      folders.map((f) => f.name),
      ["alpha", "beta"],
    );
    hubDir = dirname(file.fsPath);
    alpha = folders[0]?.uri.fsPath ?? "";
    beta = folders[1]?.uri.fsPath ?? "";
  });

  afterEach(async () => {
    await clear(CWD_KEYS);
  });

  it("defaults to the folder of the .code-workspace file", () => {
    assert.deepEqual(api.resolveCwd(), { kind: "resolved", path: hubDir, mode: "workspaceFile" });
  });

  it("namedFolder picks the folder by name", async () => {
    await set({ "cwd.mode": "namedFolder", "cwd.folderName": "beta" });
    assert.equal(resolvedPath(), beta);
  });

  it("namedFolder with an unknown name falls back to the first folder", async () => {
    await set({ "cwd.mode": "namedFolder", "cwd.folderName": "gamma" });
    const r = api.resolveCwd();
    assert.equal(r.kind === "resolved" && r.path, alpha);
    assert.equal(r.kind === "resolved" && r.failure?.mode, "namedFolder");
  });

  it("firstFolder", async () => {
    await set({ "cwd.mode": "firstFolder" });
    assert.equal(resolvedPath(), alpha);
  });

  it("activeFile follows the active editor", async () => {
    await set({ "cwd.mode": "activeFile" });
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(beta, "beta.txt")));
    await vscode.window.showTextDocument(doc);
    assert.equal(resolvedPath(), beta);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("pick offers the hub, then every folder", async () => {
    await set({ "cwd.mode": "pick" });
    const r = api.resolveCwd();
    assert.equal(r.kind, "pick");
    assert.deepEqual(r.kind === "pick" && r.candidates.map((c) => c.path), [hubDir, alpha, beta]);
  });

  it("path expands workspace variables", async () => {
    await set({ "cwd.mode": "path", "cwd.path": "${workspaceFolder:beta}/.." });
    assert.equal(resolvedPath(), hubDir);
  });

  it("workspace settings live in the .code-workspace file and win over user settings", async () => {
    await set({ "cwd.mode": "firstFolder" }, Global);
    await set({ "cwd.mode": "namedFolder", "cwd.folderName": "beta" }, Workspace);

    assert.equal(workspaceFileSettings()["harnessLauncher.cwd.mode"], "namedFolder");
    assert.equal(workspaceFileSettings()["harnessLauncher.cwd.folderName"], "beta");
    assert.equal(resolvedPath(), beta);

    await config().update("cwd.mode", undefined, Workspace);
    assert.equal(workspaceFileSettings()["harnessLauncher.cwd.mode"], undefined);
    assert.equal(resolvedPath(), alpha);
  });
});

describe("harness settings and commands", () => {
  const harnessKeys = ["claude.resumeArgs", "customHarnesses"];

  afterEach(async () => {
    await clear(harnessKeys);
    for (const terminal of vscode.window.terminals) {
      terminal.dispose();
    }
  });

  it("a workspace-level resumeArgs override reaches the harness list", async () => {
    await set({ "claude.resumeArgs": "--continue" });
    assert.equal(api.harnesses().find((h) => h.id === "claude")?.resumeArgs, "--continue");
  });

  it("detects a real executable with --version", async () => {
    const detection = await api.detect(process.execPath);
    assert.equal(detection.found, true, detection.reason);
    assert.match(detection.version ?? "", /\d+\.\d+/);
  });

  it("launch opens a named terminal for a custom harness", async () => {
    await set({ customHarnesses: [{ id: "probe", label: "Probe Harness", command: "node", newArgs: "--version" }] }, Global);
    const opened = new Promise<vscode.Terminal>((done) => {
      const listener = vscode.window.onDidOpenTerminal((t) => {
        listener.dispose();
        done(t);
      });
    });
    await vscode.commands.executeCommand("harnessLauncher.launch", { harness: "probe", action: "new" });
    const terminal = await opened;
    assert.equal(terminal.name, "Probe Harness");
  });

  it("open shows the quick pick without throwing", async () => {
    await vscode.commands.executeCommand("harnessLauncher.open");
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  });
});
