// Command handlers: the quick pick, launching a harness and the cwd prompt.
import * as vscode from "vscode";
import { ClickTracker } from "./click";
import {
  commandLineFor,
  offersContinue,
  readCwdSettings,
  readHarnesses,
  readQuickLaunch,
  readTerminalLocation,
  withCommandSkippingShell,
  type Harness,
  type SettingsReader,
} from "./config";
import { resolveCwd, type CwdResolution } from "./cwd";
import type { Detection, Detector } from "./detect";
import type { Action } from "./harnesses";
import { displayCommandLine, isDirectory, launchInTerminal } from "./terminal";
import { Notices, SECTION, settingsReader, workspaceSnapshot } from "./workspace";

interface PickItem extends vscode.QuickPickItem {
  readonly run?: () => Promise<void>;
}

const ACTION_ITEMS: readonly { readonly action: Action; readonly icon: string; readonly title: string }[] = [
  { action: "new", icon: "add", title: "New session" },
  { action: "continue", icon: "debug-continue", title: "Continue last session" },
  { action: "resume", icon: "history", title: "Resume session" },
];

function settingsQuery(harness: Harness): string {
  return harness.source === "builtin" ? `${SECTION}.${harness.id}` : `${SECTION}.customHarnesses`;
}

export class Launcher {
  private readonly notices: Notices;
  private readonly clicks = new ClickTracker();
  private loggedPath: string | undefined;

  constructor(
    private readonly detector: Detector,
    private readonly extensionId: string,
    private readonly log: vscode.LogOutputChannel,
    private readonly restricted: ReadonlySet<string>,
  ) {
    this.notices = new Notices(log);
  }

  private settings(): SettingsReader {
    return settingsReader(this.restricted, (key) =>
      this.notices.warnOnce(`Restricted Mode: ignoring the workspace value of ${SECTION}.${key}; using your user setting.`),
    );
  }

  currentHarnesses(): Harness[] {
    const { value, errors } = readHarnesses(this.settings());
    errors.forEach((e) => this.notices.warnOnce(e));
    return value;
  }

  currentCwd(): CwdResolution {
    const { value, errors } = readCwdSettings(this.settings());
    errors.forEach((e) => this.notices.warnOnce(e));
    return resolveCwd(value, workspaceSnapshot());
  }

  async open(): Promise<void> {
    const picker = vscode.window.createQuickPick<PickItem>();
    picker.title = "Harness Launcher";
    picker.placeholder = "Detecting harnesses…";
    picker.matchOnDescription = true;
    picker.busy = true;
    picker.items = this.footer();
    picker.show();

    picker.onDidAccept(() => {
      const item = picker.selectedItems[0];
      picker.hide();
      if (item?.run !== undefined) {
        void item.run();
      }
    });
    let hidden = false;
    picker.onDidHide(() => {
      hidden = true;
      picker.dispose();
    });

    this.log.info(`open: workspace ${vscode.workspace.isTrusted ? "trusted" : "not trusted (Restricted Mode)"}`);
    const items = await this.pickItems();
    if (hidden) {
      return;
    }
    picker.items = [...items, ...this.footer()];
    picker.placeholder = "Start or resume a session";
    picker.busy = false;
  }

  /**
   * A click on a rocket button. With a quick launch harness set, a double click
   * starts its New session and a single click opens the launcher after the
   * double-click window; without one, the launcher opens at once.
   */
  click(): void {
    const quick = readQuickLaunch(this.settings());
    if (quick === undefined) {
      void this.open();
      return;
    }
    this.clicks.click(
      () => void this.open(),
      () => void this.quickLaunch(quick),
    );
  }

  /** The Quick Launch command, for a key binding: the double-click without the mouse. */
  async quickLaunchCommand(): Promise<void> {
    const quick = readQuickLaunch(this.settings());
    if (quick === undefined) {
      const open = "Open Settings";
      const answer = await vscode.window.showWarningMessage(
        `Harness Launcher: quick launch is not configured. Pick a harness in ${SECTION}.quickLaunch.harness.`,
        open,
      );
      if (answer === open) {
        await vscode.commands.executeCommand("workbench.action.openSettings", `${SECTION}.quickLaunch.harness`);
      }
      return;
    }
    await this.quickLaunch(quick);
  }

  /**
   * Lets the Quick Launch key binding through terminals, which otherwise send
   * keys to the shell, then opens Keyboard Shortcuts on the command. There is
   * no API to write `keybindings.json`, so the user records the keys.
   */
  async setUpQuickLaunchShortcut(): Promise<void> {
    const command = `${SECTION}.quickLaunch`;
    const terminal = vscode.workspace.getConfiguration("terminal.integrated");
    const skip = withCommandSkippingShell(terminal.inspect("commandsToSkipShell")?.globalValue, command);
    if (skip !== undefined) {
      await terminal.update("commandsToSkipShell", skip, vscode.ConfigurationTarget.Global);
      this.log.info(`shortcut setup: added ${command} to terminal.integrated.commandsToSkipShell`);
    }
    await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", command);
    void vscode.window.showInformationMessage(
      "Harness Launcher: double-click Harness Launcher: Quick Launch, press the keys you want, then Enter. The shortcut also works while a terminal has focus.",
    );
  }

  private async quickLaunch(harnessId: string): Promise<void> {
    const harness = this.currentHarnesses().find((h) => h.id === harnessId);
    if (harness?.enabled === "auto") {
      const detection = await this.detector.detect(harness.command);
      if (!detection.found) {
        this.log.info(`quick launch ${harness.id}: not detected: ${detection.reason}`);
        void vscode.window.showWarningMessage(`Harness Launcher: ${harness.label} is not detected, so double-click cannot start it.`);
        await this.open();
        return;
      }
    }
    await this.launch(harnessId, "new");
  }

  async launch(harnessId: string, action: Action): Promise<void> {
    const harness = this.currentHarnesses().find((h) => h.id === harnessId);
    if (harness === undefined) {
      const known = this.currentHarnesses()
        .map((h) => h.id)
        .join(", ");
      void vscode.window.showErrorMessage(`Harness Launcher: unknown harness "${harnessId}". Known ids: ${known}.`);
      return;
    }
    if (harness.enabled === "never") {
      void vscode.window.showErrorMessage(
        `Harness Launcher: ${harness.label} is disabled (${SECTION}.${harness.id}.enabled is "never").`,
      );
      return;
    }

    const line = commandLineFor(harness, action);
    if (!line.ok) {
      void this.settingsError(line.error, settingsQuery(harness));
      return;
    }

    const cwd = await this.chooseCwd();
    if (cwd === undefined) {
      return;
    }
    if (!isDirectory(cwd.path)) {
      void this.settingsError(
        `the working directory "${cwd.path}" does not exist. Fix ${SECTION}.cwd.${cwd.mode === "path" ? "path" : "mode"}.`,
        `${SECTION}.cwd`,
      );
      return;
    }

    const location = readTerminalLocation(this.settings());
    const method = await launchInTerminal({
      name: harness.label,
      cwd: cwd.path,
      executable: line.executable,
      args: line.args,
      location,
    });
    this.log.info(
      `launch ${harness.id}/${action}: ${JSON.stringify([line.executable, ...line.args])} in ${cwd.path} (cwd ${cwd.mode}, ${location}, ${method})`,
    );
  }

  refresh(): void {
    this.detector.clear();
    void vscode.window.showInformationMessage("Harness Launcher: detection cleared; the next launcher run checks again.");
  }

  configure(): Thenable<unknown> {
    return vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${this.extensionId}`);
  }

  private async chooseCwd(): Promise<{ path: string; mode: string } | undefined> {
    const resolution = this.currentCwd();
    if (resolution.kind === "pick") {
      const choice = await vscode.window.showQuickPick(
        resolution.candidates.map((c) => ({ label: c.label, description: c.description, path: c.path })),
        { title: "Harness Launcher: working directory", placeHolder: "Start the terminal in…" },
      );
      return choice === undefined ? undefined : { path: choice.path, mode: "pick" };
    }
    if (resolution.failure !== undefined) {
      this.notices.warnOnce(
        `cwd.mode "${resolution.failure.mode}" could not resolve (${resolution.failure.reason}); using ${resolution.path}.`,
      );
    }
    return { path: resolution.path, mode: resolution.mode };
  }

  private async pickItems(): Promise<PickItem[]> {
    const harnesses = this.currentHarnesses().filter((h) => h.enabled !== "never");
    const detections = await Promise.all(harnesses.map((h) => this.detector.detect(h.command)));
    harnesses.forEach((h, i) => {
      const d = detections[i];
      this.log.info(
        `detect ${h.id} (${h.command}): ${d?.found ? `found ${d.path} "${d.version}"` : `not found${d?.path ? ` at ${d.path}` : ""}: ${d?.reason}`}`,
      );
    });
    // The PATH VS Code handed to the extension host explains most "not on PATH" reports.
    const path = process.env["PATH"] ?? "(unset)";
    if (detections.some((d) => !d.found) && path !== this.loggedPath) {
      this.loggedPath = path;
      this.log.info(`detect: PATH is ${path}`);
    }
    const cwd = this.currentCwd();
    const where = cwd.kind === "pick" ? "choose folder" : cwd.path;

    const items: PickItem[] = [];
    harnesses.forEach((harness, i) => {
      const detection = detections[i];
      if (detection === undefined || (harness.enabled === "auto" && !detection.found)) {
        return;
      }
      items.push({ label: harness.label, kind: vscode.QuickPickItemKind.Separator });
      for (const a of ACTION_ITEMS) {
        if (a.action !== "continue" || offersContinue(harness)) {
          items.push(this.actionItem(harness, a, where, detection));
        }
      }
    });

    if (items.length === 0) {
      items.push({
        label: "$(info) No harness detected",
        description: "Install a CLI, then Refresh Detection, or set a harness to “always”",
        run: async () => {
          await this.configure();
        },
      });
    }
    return items;
  }

  private actionItem(harness: Harness, a: (typeof ACTION_ITEMS)[number], where: string, detection: Detection): PickItem {
    const line = commandLineFor(harness, a.action);
    if (!line.ok) {
      return {
        label: `$(error) ${a.title}`,
        description: line.error,
        run: () => this.settingsError(line.error, settingsQuery(harness)),
      };
    }
    return {
      label: `$(${a.icon}) ${a.title}`,
      description: `${displayCommandLine(line.executable, line.args)}  ·  ${where}`,
      detail: detection.found ? undefined : `Not detected: ${detection.reason ?? "unknown reason"}`,
      run: () => this.launch(harness.id, a.action),
    };
  }

  private footer(): PickItem[] {
    return [
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      {
        label: "$(refresh) Refresh detection",
        run: async () => {
          this.detector.clear();
          await this.open();
        },
      },
      {
        label: "$(gear) Configure…",
        description: "Settings for this extension",
        run: async () => {
          await this.configure();
        },
      },
    ];
  }

  private async settingsError(message: string, settingQuery: string): Promise<void> {
    const open = "Open Settings";
    const answer = await vscode.window.showErrorMessage(`Harness Launcher: ${message}`, open);
    if (answer === open) {
      await vscode.commands.executeCommand("workbench.action.openSettings", settingQuery);
    }
  }
}
