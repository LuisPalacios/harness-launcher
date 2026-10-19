// Integration test config. The fixture hub is copied first, because the tests
// write workspace settings into its .code-workspace file.
import { defineConfig } from "@vscode/test-cli";
import { cpSync, rmSync } from "node:fs";

const hub = ".vscode-test/hub-copy";
rmSync(hub, { recursive: true, force: true });
cpSync("test/fixtures/hub", hub, { recursive: true });

export default defineConfig({
  files: "out/test/**/*.test.js",
  // VSCODE_TEST_VERSION=1.93.0 runs the suite on the minimum supported engine.
  version: process.env.VSCODE_TEST_VERSION ?? "stable",
  workspaceFolder: `${hub}/hub.code-workspace`,
  launchArgs: ["--disable-extensions"],
  mocha: { ui: "bdd", timeout: 20_000 },
});
