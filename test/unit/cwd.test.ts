import { describe, expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { expandPath, resolveCwd, type CwdSettings, type WorkspaceSnapshot } from "../../src/cwd";

const hub: WorkspaceSnapshot = {
  workspaceFile: { scheme: "file", fsPath: "/work/hub/hub.code-workspace" },
  folders: [
    { name: "alpha", fsPath: "/work/hub/alpha" },
    { name: "beta", fsPath: "/work/hub/beta" },
  ],
  activeFolder: "/work/hub/beta",
  home: "/home/me",
};

const singleFolder: WorkspaceSnapshot = {
  folders: [{ name: "solo", fsPath: "/work/solo" }],
  home: "/home/me",
};

const empty: WorkspaceSnapshot = { folders: [], home: "/home/me" };

function settings(partial: Partial<CwdSettings>): CwdSettings {
  return { mode: "workspaceFile", folderName: "", path: "", ...partial };
}

describe("resolveCwd", () => {
  test("workspaceFile resolves to the hub folder", () => {
    expect(resolveCwd(settings({}), hub, posix)).toEqual({ kind: "resolved", path: "/work/hub", mode: "workspaceFile" });
  });

  test("workspaceFile in a single-folder window starts in that folder without a warning", () => {
    const r = resolveCwd(settings({}), singleFolder, posix);
    expect(r).toEqual({ kind: "resolved", path: "/work/solo", mode: "firstFolder" });
  });

  test("an untitled workspace is not a hub", () => {
    const untitled = { ...hub, workspaceFile: { scheme: "untitled", fsPath: "/tmp/Untitled-1" } };
    const r = resolveCwd(settings({}), untitled, posix);
    expect(r).toMatchObject({ path: "/work/hub/alpha", mode: "firstFolder", failure: { mode: "workspaceFile" } });
  });

  test("a remote workspace file still resolves", () => {
    const remote = { ...hub, workspaceFile: { scheme: "vscode-remote", fsPath: "/srv/hub/hub.code-workspace" } };
    expect(resolveCwd(settings({}), remote, posix)).toMatchObject({ path: "/srv/hub", mode: "workspaceFile" });
  });

  test("an empty window falls back to home", () => {
    expect(resolveCwd(settings({}), empty, posix)).toEqual({ kind: "resolved", path: "/home/me", mode: "home" });
    expect(resolveCwd(settings({ mode: "firstFolder" }), empty, posix)).toMatchObject({ path: "/home/me", mode: "home" });
  });

  test("namedFolder finds the folder by name", () => {
    expect(resolveCwd(settings({ mode: "namedFolder", folderName: "beta" }), hub, posix)).toEqual({
      kind: "resolved",
      path: "/work/hub/beta",
      mode: "namedFolder",
    });
  });

  test("namedFolder with an unknown name lists the folders", () => {
    const r = resolveCwd(settings({ mode: "namedFolder", folderName: "gamma" }), hub, posix);
    expect(r).toMatchObject({ path: "/work/hub/alpha", failure: { mode: "namedFolder" } });
    expect(r.kind === "resolved" && r.failure?.reason).toContain("alpha, beta");
  });

  test("namedFolder with an empty name names the setting", () => {
    const r = resolveCwd(settings({ mode: "namedFolder" }), hub, posix);
    expect(r.kind === "resolved" && r.failure?.reason).toContain("harnessLauncher.cwd.folderName");
  });

  test("firstFolder and activeFile", () => {
    expect(resolveCwd(settings({ mode: "firstFolder" }), hub, posix)).toMatchObject({ path: "/work/hub/alpha" });
    expect(resolveCwd(settings({ mode: "activeFile" }), hub, posix)).toMatchObject({ path: "/work/hub/beta", mode: "activeFile" });
    expect(resolveCwd(settings({ mode: "activeFile" }), singleFolder, posix)).toMatchObject({
      path: "/work/solo",
      failure: { mode: "activeFile" },
    });
  });

  test("pick offers the hub first, then every folder", () => {
    const r = resolveCwd(settings({ mode: "pick" }), hub, posix);
    expect(r.kind).toBe("pick");
    expect(r.kind === "pick" && r.candidates.map((c) => c.path)).toEqual(["/work/hub", "/work/hub/alpha", "/work/hub/beta"]);
  });

  test("pick in an empty window falls back to home", () => {
    expect(resolveCwd(settings({ mode: "pick" }), empty, posix)).toMatchObject({ path: "/home/me", failure: { mode: "pick" } });
  });

  test("path mode expands variables", () => {
    expect(resolveCwd(settings({ mode: "path", path: "${workspaceFileDir}/tools" }), hub, posix)).toMatchObject({
      path: "/work/hub/tools",
      mode: "path",
    });
  });
});

describe("expandPath", () => {
  test.each([
    ["~", "/home/me"],
    ["~/src", "/home/me/src"],
    ["${userHome}/x", "/home/me/x"],
    ["${workspaceFolder}", "/work/hub/alpha"],
    ["${workspaceFolder:beta}/sub", "/work/hub/beta/sub"],
    ["/abs/./path/../dir", "/abs/dir"],
  ])("%s -> %s", (template, expected) => {
    expect(expandPath(template, hub, posix)).toEqual({ ok: true, path: expected });
  });

  test.each([
    ["", "harnessLauncher.cwd.path is empty"],
    ["relative/dir", "absolute"],
    ["${nope}/x", "unknown variable"],
    ["${workspaceFolder:gamma}", "gamma"],
    ["${workspaceFolder:}", "missing folder name"],
  ])("%j fails with %s", (template, reason) => {
    const r = expandPath(template, hub, posix);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(reason);
  });

  test("${workspaceFileDir} fails without a saved workspace", () => {
    expect(expandPath("${workspaceFileDir}", singleFolder, posix).ok).toBe(false);
  });

  test("Windows paths", () => {
    const winHub: WorkspaceSnapshot = {
      workspaceFile: { scheme: "file", fsPath: "D:\\proj\\hub\\hub.code-workspace" },
      folders: [{ name: "alpha", fsPath: "D:\\proj\\hub\\alpha" }],
      home: "C:\\Users\\me",
    };
    expect(resolveCwd(settings({}), winHub, win32)).toMatchObject({ path: "D:\\proj\\hub" });
    expect(expandPath("~\\code", winHub, win32)).toEqual({ ok: true, path: "C:\\Users\\me\\code" });
    expect(expandPath("${workspaceFileDir}\\..\\other", winHub, win32)).toEqual({ ok: true, path: "D:\\proj\\other" });
  });
});
