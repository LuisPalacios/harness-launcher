// Bundles the extension into dist/extension.js and, with --tests, the
// integration suite into out/test/. Flags: --production, --watch, --tests.
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  // VS Code 1.93 runs extensions on Electron 30 (Node 20).
  target: "node20",
  external: ["vscode"],
  // jsonc-parser's "main" is a UMD build whose requires esbuild cannot follow.
  mainFields: ["module", "main"],
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    minify: production,
    sourcemap: !production,
  },
];

if (tests) {
  const dir = "test/integration";
  builds.push({
    ...common,
    entryPoints: readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${dir}/${f}`),
    outdir: "out/test",
    external: ["vscode", "mocha"],
    sourcemap: true,
  });
}

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
