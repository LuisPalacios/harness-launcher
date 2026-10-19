// Opens an integrated terminal with the user's default profile and runs the
// harness in it, through shell integration when it activates in time.
import { statSync } from "node:fs";
import * as vscode from "vscode";
import type { TerminalLocationSetting } from "./config";
import { quoteCommandLine, shellKindFromPath } from "./quote";

const SHELL_INTEGRATION_TIMEOUT_MS = 3000;

export interface LaunchRequest {
  readonly name: string;
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly location: TerminalLocationSetting;
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function displayCommandLine(executable: string, args: readonly string[]): string {
  return quoteCommandLine(shellKindFromPath(vscode.env.shell), executable, args);
}

function terminalLocation(setting: TerminalLocationSetting): vscode.TerminalOptions["location"] {
  switch (setting) {
    case "panel":
      return vscode.TerminalLocation.Panel;
    case "editor":
      return vscode.TerminalLocation.Editor;
    case "editorBeside":
      return { viewColumn: vscode.ViewColumn.Beside };
  }
}

export type LaunchMethod = "shellIntegration" | "sendText";

export async function launchInTerminal(request: LaunchRequest): Promise<LaunchMethod> {
  // No shellPath: the default profile keeps the user's PATH, profile and aliases,
  // and the terminal stays open after the CLI exits.
  const terminal = vscode.window.createTerminal({
    name: request.name,
    cwd: request.cwd,
    location: terminalLocation(request.location),
    iconPath: new vscode.ThemeIcon("terminal"),
  });
  terminal.show();

  const integration = await waitForShellIntegration(terminal, SHELL_INTEGRATION_TIMEOUT_MS);
  if (integration !== undefined) {
    integration.executeCommand(request.executable, [...request.args]);
    return "shellIntegration";
  }
  terminal.sendText(displayCommandLine(request.executable, request.args), true);
  return "sendText";
}

function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration !== undefined) {
    return Promise.resolve(terminal.shellIntegration);
  }
  return new Promise((resolve) => {
    const done = (value: vscode.TerminalShellIntegration | undefined): void => {
      clearTimeout(timer);
      listener.dispose();
      resolve(value);
    };
    const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) {
        done(e.shellIntegration);
      }
    });
    const timer = setTimeout(() => done(undefined), timeoutMs);
  });
}
