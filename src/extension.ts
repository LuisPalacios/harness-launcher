import { homedir } from "node:os";
import * as vscode from "vscode";
import type { Harness } from "./config";
import type { CwdResolution } from "./cwd";
import { createDetector, type Detection } from "./detect";
import type { Action } from "./harnesses";
import { Launcher } from "./launcher";

const PROBE_TIMEOUT_MS = 3000;

/** Returned from `activate` so integration tests can inspect the resolved state. */
export interface HarnessLauncherApi {
  harnesses(): Harness[];
  resolveCwd(): CwdResolution;
  detect(command: string): Promise<Detection>;
}

interface LaunchArgs {
  readonly harness: string;
  readonly action: Action;
}

function isLaunchArgs(value: unknown): value is LaunchArgs {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v["harness"] === "string" && (v["action"] === "new" || v["action"] === "resume");
}

export function activate(context: vscode.ExtensionContext): HarnessLauncherApi {
  const detector = createDetector({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const log = vscode.window.createOutputChannel("Harness Launcher", { log: true });
  const launcher = new Launcher(detector, context.extension.id, log);

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand("harnessLauncher.open", () => launcher.open()),
    vscode.commands.registerCommand("harnessLauncher.launch", (args: unknown) => {
      if (!isLaunchArgs(args)) {
        void vscode.window.showErrorMessage(
          'Harness Launcher: harnessLauncher.launch needs args like { "harness": "claude", "action": "new" | "resume" }.',
        );
        return;
      }
      return launcher.launch(args.harness, args.action);
    }),
    vscode.commands.registerCommand("harnessLauncher.refresh", () => launcher.refresh()),
    vscode.commands.registerCommand("harnessLauncher.configure", () => launcher.configure()),
  );

  return {
    harnesses: () => launcher.currentHarnesses(),
    resolveCwd: () => launcher.currentCwd(),
    detect: (command) => detector.detect(command),
  };
}

export function deactivate(): void {}
