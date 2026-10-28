import { homedir } from "node:os";
import * as vscode from "vscode";
import { readHarnesses, readQuickLaunch, readStatusBarEnabled, restrictedKeys, type Harness } from "./config";
import type { CwdResolution } from "./cwd";
import { createDetector, type Detection } from "./detect";
import { ACTIONS, type Action } from "./harnesses";
import { Launcher } from "./launcher";
import { SECTION, settingsReader } from "./workspace";

const PROBE_TIMEOUT_MS = 3000;

/** Returned from `activate` so integration tests can inspect the resolved state. */
export interface HarnessLauncherApi {
  harnesses(): Harness[];
  resolveCwd(): CwdResolution;
  detect(command: string): Promise<Detection>;
  quickLaunchShortcut(): Promise<string | undefined>;
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
  return typeof v["harness"] === "string" && (ACTIONS as readonly unknown[]).includes(v["action"]);
}

/** Always-visible way in: the title bar button only shows while a file is open. */
function createStatusBarButton(restricted: ReadonlySet<string>): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("harnessLauncher.status", vscode.StatusBarAlignment.Right, 100);
  item.name = "Harness Launcher";
  // The rocket of the title bar button as a font glyph (contributes.icons), since
  // the status bar only draws single-color icons.
  item.text = "$(harness-launcher-rocket)";
  item.command = "harnessLauncher.click";
  const sync = (): void => {
    const read = settingsReader(restricted);
    const quick = readQuickLaunch(read);
    const label = readHarnesses(read).value.find((h) => h.id === quick)?.label;
    item.tooltip =
      "Harness Launcher: start, continue or resume a session" +
      (label === undefined ? "" : `\nDouble-click: new ${label} session`);
    if (readStatusBarEnabled(read)) {
      item.show();
    } else {
      item.hide();
    }
  };
  sync();
  const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      sync();
    }
  });
  return vscode.Disposable.from(item, watcher);
}

export function activate(context: vscode.ExtensionContext): HarnessLauncherApi {
  const detector = createDetector({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const log = vscode.window.createOutputChannel("Harness Launcher", { log: true });
  const restricted = restrictedKeys(context.extension.packageJSON, SECTION);
  const launcher = new Launcher(detector, context.extension.id, log, restricted, context.globalStorageUri);

  context.subscriptions.push(
    log,
    vscode.commands.registerCommand("harnessLauncher.open", () => launcher.open()),
    vscode.commands.registerCommand("harnessLauncher.click", () => launcher.click()),
    vscode.commands.registerCommand("harnessLauncher.quickLaunch", () => launcher.quickLaunchCommand()),
    vscode.commands.registerCommand("harnessLauncher.setQuickLaunchShortcut", (key: unknown) => launcher.setQuickLaunchShortcut(key)),
    vscode.commands.registerCommand("harnessLauncher.launch", (args: unknown) => {
      if (!isLaunchArgs(args)) {
        void vscode.window.showErrorMessage(
          'Harness Launcher: harnessLauncher.launch needs args like { "harness": "claude", "action": "new" | "continue" | "resume" }.',
        );
        return;
      }
      return launcher.launch(args.harness, args.action);
    }),
    vscode.commands.registerCommand("harnessLauncher.refresh", () => launcher.refresh()),
    vscode.commands.registerCommand("harnessLauncher.configure", () => launcher.configure()),
    createStatusBarButton(restricted),
  );

  return {
    harnesses: () => launcher.currentHarnesses(),
    resolveCwd: () => launcher.currentCwd(),
    detect: (command) => detector.detect(command),
    quickLaunchShortcut: () => launcher.currentQuickLaunchShortcut(),
  };
}

export function deactivate(): void {}
