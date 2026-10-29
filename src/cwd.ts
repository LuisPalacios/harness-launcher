// Resolves the terminal's working directory from the cwd.* settings and a
// snapshot of the workspace. The glue layer builds the snapshot from the
// VS Code API; this module only computes.
import * as nodePath from "node:path";

export const CWD_MODES = ["workspaceFile", "namedFolder", "firstFolder", "activeFile", "pick", "path"] as const;
export type CwdMode = (typeof CWD_MODES)[number];

export interface WorkspaceFolderInfo {
  readonly name: string;
  readonly fsPath: string;
}

export interface WorkspaceSnapshot {
  /** `workspace.workspaceFile`: undefined in a single-folder or empty window. */
  readonly workspaceFile?: { readonly scheme: string; readonly fsPath: string } | undefined;
  readonly folders: readonly WorkspaceFolderInfo[];
  /** Workspace folder that holds the active editor's file, if any. */
  readonly activeFolder?: string | undefined;
  readonly home: string;
}

export interface CwdSettings {
  readonly mode: CwdMode;
  readonly folderName: string;
  readonly path: string;
}

export interface CwdFailure {
  readonly mode: CwdMode;
  readonly reason: string;
}

export interface PickCandidate {
  readonly label: string;
  readonly description: string;
  readonly path: string;
}

export type CwdResolution =
  | { readonly kind: "resolved"; readonly path: string; readonly mode: CwdMode | "home"; readonly failure?: CwdFailure }
  | { readonly kind: "pick"; readonly candidates: readonly PickCandidate[] };

type Attempt = { ok: true; path: string } | { ok: false; reason: string };

export function isCwdMode(value: unknown): value is CwdMode {
  return typeof value === "string" && (CWD_MODES as readonly string[]).includes(value);
}

export function resolveCwd(
  settings: CwdSettings,
  ws: WorkspaceSnapshot,
  path: nodePath.PlatformPath = nodePath,
): CwdResolution {
  if (settings.mode === "pick") {
    const candidates = pickCandidates(ws, path);
    if (candidates.length > 0) {
      return { kind: "pick", candidates };
    }
    return fallback({ mode: "pick", reason: "the window has no workspace folders" }, ws);
  }

  // workspaceFile is the default, so a window without a .code-workspace file
  // (single folder or empty) is normal: start in the opened folder, no warning.
  if (settings.mode === "workspaceFile" && ws.workspaceFile === undefined) {
    return fallback(undefined, ws);
  }

  const attempt = attemptMode(settings, ws, path);
  if (attempt.ok) {
    return { kind: "resolved", path: attempt.path, mode: settings.mode };
  }
  return fallback({ mode: settings.mode, reason: attempt.reason }, ws);
}

/** The folder of a saved `.code-workspace` file: the hub of a multi-root workspace. */
export function workspaceFileDir(ws: WorkspaceSnapshot, path: nodePath.PlatformPath = nodePath): Attempt {
  if (ws.workspaceFile === undefined) {
    return { ok: false, reason: "the window has no .code-workspace file (single folder or empty window)" };
  }
  if (ws.workspaceFile.scheme === "untitled") {
    return { ok: false, reason: "the workspace is untitled; save it as a .code-workspace file first" };
  }
  return { ok: true, path: path.dirname(ws.workspaceFile.fsPath) };
}

function attemptMode(settings: CwdSettings, ws: WorkspaceSnapshot, path: nodePath.PlatformPath): Attempt {
  switch (settings.mode) {
    case "workspaceFile":
      return workspaceFileDir(ws, path);
    case "namedFolder":
      return namedFolder(settings.folderName, ws);
    case "firstFolder":
      return firstFolder(ws);
    case "activeFile":
      return ws.activeFolder === undefined
        ? { ok: false, reason: "the active editor is not inside a workspace folder" }
        : { ok: true, path: ws.activeFolder };
    case "path":
      return expandPath(settings.path, ws, path);
    case "pick":
      return { ok: false, reason: "pick is resolved interactively" };
  }
}

function namedFolder(name: string, ws: WorkspaceSnapshot): Attempt {
  if (name.trim() === "") {
    return { ok: false, reason: "harnessLauncher.cwd.folderName is empty" };
  }
  const folder = ws.folders.find((f) => f.name === name);
  if (folder === undefined) {
    const names = ws.folders.map((f) => f.name).join(", ") || "none";
    return { ok: false, reason: `no workspace folder has the Explorer name "${name}" (Explorer names: ${names})` };
  }
  return { ok: true, path: folder.fsPath };
}

function firstFolder(ws: WorkspaceSnapshot): Attempt {
  const first = ws.folders[0];
  return first === undefined ? { ok: false, reason: "the window has no workspace folders" } : { ok: true, path: first.fsPath };
}

function fallback(failure: CwdFailure | undefined, ws: WorkspaceSnapshot): CwdResolution {
  const first = ws.folders[0];
  const resolved =
    first !== undefined
      ? ({ kind: "resolved", path: first.fsPath, mode: "firstFolder" } as const)
      : ({ kind: "resolved", path: ws.home, mode: "home" } as const);
  return failure === undefined ? resolved : { ...resolved, failure };
}

function pickCandidates(ws: WorkspaceSnapshot, path: nodePath.PlatformPath): PickCandidate[] {
  const candidates: PickCandidate[] = [];
  const hub = workspaceFileDir(ws, path);
  if (hub.ok) {
    candidates.push({ label: "Workspace file folder", description: hub.path, path: hub.path });
  }
  for (const f of ws.folders) {
    candidates.push({ label: f.name, description: f.fsPath, path: f.fsPath });
  }
  return candidates;
}

const VARIABLE = /\$\{([^}]*)\}/g;

/**
 * Expands `~`, `${userHome}`, `${workspaceFileDir}`, `${workspaceFolder}` (the
 * first folder) and `${workspaceFolder:<name>}`. The result must be absolute.
 */
export function expandPath(template: string, ws: WorkspaceSnapshot, path: nodePath.PlatformPath = nodePath): Attempt {
  const trimmed = template.trim();
  if (trimmed === "") {
    return { ok: false, reason: "harnessLauncher.cwd.path is empty" };
  }

  let failure: string | undefined;
  let expanded = trimmed.replace(VARIABLE, (whole, name: string) => {
    const value = variableValue(name, ws, path);
    if (value.ok) {
      return value.path;
    }
    failure ??= `${whole}: ${value.reason}`;
    return whole;
  });
  if (failure !== undefined) {
    return { ok: false, reason: failure };
  }

  if (expanded === "~" || expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = ws.home + expanded.slice(1);
  }
  if (!path.isAbsolute(expanded)) {
    return { ok: false, reason: `"${trimmed}" does not resolve to an absolute path` };
  }
  return { ok: true, path: path.normalize(expanded) };
}

function variableValue(name: string, ws: WorkspaceSnapshot, path: nodePath.PlatformPath): Attempt {
  if (name === "userHome") {
    return { ok: true, path: ws.home };
  }
  if (name === "workspaceFileDir") {
    return workspaceFileDir(ws, path);
  }
  if (name === "workspaceFolder") {
    return firstFolder(ws);
  }
  if (name.startsWith("workspaceFolder:")) {
    const folderName = name.slice("workspaceFolder:".length);
    return folderName === "" ? { ok: false, reason: "missing folder name" } : namedFolder(folderName, ws);
  }
  return { ok: false, reason: "unknown variable" };
}
