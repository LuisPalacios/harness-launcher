// Command handlers: the quick pick, launching a harness and the cwd prompt.
import * as vscode from "vscode";
import {
  commandLineFor,
  readCwdSettings,
  readHarnesses,
  readTerminalLocation,
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

const ACTIONS: readonly { readonly action: Action; readonly icon: string; readonly title: string }[] = [
  { action: "new", icon: "add", title: "New session" },
  { action: "resume", icon: "history", title: "Resume session" },
];

function settingsQuery(harness: Harness): string {
  return harness.source === "builtin" ? `${SECTION}.${harness.id}` : `${SECTION}.customHarnesses`;
}

export class Launcher {
  private readonly notices: Notices;

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
    const cwd = this.currentCwd();
    const where = cwd.kind === "pick" ? "choose folder" : cwd.path;

    const items: PickItem[] = [];
    harnesses.forEach((harness, i) => {
      const detection = detections[i];
      if (detection === undefined || (harness.enabled === "auto" && !detection.found)) {
        return;
      }
      items.push({ label: harness.label, kind: vscode.QuickPickItemKind.Separator });
      for (const a of ACTIONS) {
        items.push(this.actionItem(harness, a, where, detection));
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

  private actionItem(harness: Harness, a: (typeof ACTIONS)[number], where: string, detection: Detection): PickItem {
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
