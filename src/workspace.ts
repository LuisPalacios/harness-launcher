// Adapters from the VS Code API to the pure modules' inputs.
import { homedir } from "node:os";
import * as vscode from "vscode";
import { trustAwareReader, type SettingsReader } from "./config";
import type { WorkspaceSnapshot } from "./cwd";

export const SECTION = "harnessLauncher";

export function settingsReader(restricted: ReadonlySet<string>, onIgnored?: (key: string) => void): SettingsReader {
  const config = vscode.workspace.getConfiguration(SECTION);
  return trustAwareReader({
    read: (key) => config.get<unknown>(key),
    inspect: (key) => config.inspect<unknown>(key),
    restricted,
    trusted: vscode.workspace.isTrusted,
    ...(onIgnored === undefined ? {} : { onIgnored }),
  });
}

export function workspaceSnapshot(): WorkspaceSnapshot {
  const file = vscode.workspace.workspaceFile;
  const active = vscode.window.activeTextEditor?.document.uri;
  return {
    workspaceFile: file === undefined ? undefined : { scheme: file.scheme, fsPath: file.fsPath },
    folders: (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, fsPath: f.uri.fsPath })),
    activeFolder: active === undefined ? undefined : vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath,
    home: homedir(),
  };
}

/** Shows each distinct warning once per session, so a broken setting is visible but not noisy. */
export class Notices {
  private readonly shown = new Set<string>();

  constructor(private readonly log: vscode.LogOutputChannel) {}

  warnOnce(message: string): void {
    if (!this.shown.has(message)) {
      this.shown.add(message);
      this.log.warn(message);
      void vscode.window.showWarningMessage(`Harness Launcher: ${message}`);
    }
  }
}
