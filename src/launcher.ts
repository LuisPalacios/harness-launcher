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
import { currentShortcut, normalizeShortcut, withShortcut } from "./keybindings";
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

const QUICK_LAUNCH_COMMAND = `${SECTION}.quickLaunch`;

function settingsQuery(harness: Harness): string {
  return harness.source === "builtin" ? `${SECTION}.${harness.id}` : `${SECTION}.customHarnesses`;
}

function textTabUri(tab: vscode.Tab): string | undefined {
  return tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined;
}

function textTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => textTabUri(t) !== undefined);
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
    private readonly globalStorage: vscode.Uri,
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
      await this.quickLaunchNotConfigured();
      return;
    }
    await this.quickLaunch(quick);
  }

  /**
   * Binds Quick Launch to a typed shortcut in the user's keybindings.json and
   * lets that shortcut through terminals, which otherwise send every key to the
   * shell. A string argument skips the prompt.
   */
  async setQuickLaunchShortcut(typed?: unknown): Promise<void> {
    const quick = readQuickLaunch(this.settings());
    if (quick === undefined) {
      await this.quickLaunchNotConfigured();
      return;
    }
    const label = this.currentHarnesses().find((h) => h.id === quick)?.label ?? quick;
    const current = typeof typed === "string" ? undefined : await this.currentQuickLaunchShortcut();
    const input =
      typeof typed === "string"
        ? typed
        : await vscode.window.showInputBox({
            title: "Harness Launcher: Quick Launch shortcut",
            prompt: `Keys that start a new ${label} session, also from a terminal. Type them as text, for example shift+alt+l or ctrl+k l.`,
            placeHolder: "shift+alt+l",
            value: current,
            validateInput: (value) => {
              const key = normalizeShortcut(value);
              return key.ok ? undefined : key.error;
            },
          });
    if (input === undefined) {
      return;
    }
    const key = normalizeShortcut(input);
    if (!key.ok) {
      void vscode.window.showErrorMessage(`Harness Launcher: ${key.error}.`);
      return;
    }
    const failure = await this.saveKeybinding(QUICK_LAUNCH_COMMAND, key.value);
    if (failure !== undefined) {
      this.log.warn(`shortcut ${key.value}: ${failure}`);
      void vscode.window.showErrorMessage(`Harness Launcher: ${failure}.`);
      return;
    }
    const terminal = vscode.workspace.getConfiguration("terminal.integrated");
    const skip = withCommandSkippingShell(terminal.inspect("commandsToSkipShell")?.globalValue, QUICK_LAUNCH_COMMAND);
    if (skip !== undefined) {
      await terminal.update("commandsToSkipShell", skip, vscode.ConfigurationTarget.Global);
    }
    this.log.info(`shortcut ${key.value}: bound to ${QUICK_LAUNCH_COMMAND}${skip === undefined ? "" : ", added to terminal.integrated.commandsToSkipShell"}`);
    void vscode.window.showInformationMessage(`Harness Launcher: ${key.value} now starts a new ${label} session, also from a terminal.`);
  }

  /**
   * The key keybindings.json binds to Quick Launch, if any. The file sits in the
   * profile folder above the extension's global storage; a profile without its
   * own key bindings uses the default profile's file.
   */
  async currentQuickLaunchShortcut(): Promise<string | undefined> {
    const profile = vscode.Uri.joinPath(this.globalStorage, "..", "..");
    const candidates = [vscode.Uri.joinPath(profile, "keybindings.json")];
    if (profile.path.includes("/profiles/")) {
      candidates.push(vscode.Uri.joinPath(profile, "..", "..", "keybindings.json"));
    }
    for (const uri of candidates) {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        return currentShortcut(text, QUICK_LAUNCH_COMMAND);
      } catch {
        // Not there; try the next one.
      }
    }
    return undefined;
  }

  /**
   * Edits keybindings.json through its editor, so the file of the active
   * profile is the one that changes. Returns why it could not, or undefined.
   */
  private async saveKeybinding(command: string, key: string): Promise<string | undefined> {
    const openBefore = new Set(textTabs().map(textTabUri));

    await vscode.commands.executeCommand("workbench.action.openGlobalKeybindingsFile");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || !editor.document.uri.path.endsWith("/keybindings.json")) {
      return "could not open keybindings.json";
    }
    const doc = editor.document;
    if (doc.isDirty) {
      return "keybindings.json has unsaved changes; save or revert them, then try again";
    }
    const text = doc.getText();
    const next = withShortcut(text, command, key, {
      insertSpaces: editor.options.insertSpaces !== false,
      tabSize: typeof editor.options.tabSize === "number" ? editor.options.tabSize : 4,
      eol: doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    });
    if (!next.ok) {
      return next.error;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), next.value);
    if (!(await vscode.workspace.applyEdit(edit)) || !(await doc.save())) {
      return "could not save keybindings.json";
    }
    const tab = textTabs().find((t) => textTabUri(t) === doc.uri.toString());
    if (tab !== undefined && !openBefore.has(doc.uri.toString())) {
      await vscode.window.tabGroups.close(tab);
    }
    return undefined;
  }

  private async quickLaunchNotConfigured(): Promise<void> {
    const open = "Open Settings";
    const answer = await vscode.window.showWarningMessage(
      `Harness Launcher: quick launch is not configured. Pick a harness in ${SECTION}.quickLaunch.harness.`,
      open,
    );
    if (answer === open) {
      await vscode.commands.executeCommand("workbench.action.openSettings", `${SECTION}.quickLaunch.harness`);
    }
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
