#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

if (process.platform !== "darwin") {
  console.error("macOS packaging must run on macOS.");
  process.exit(1);
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  console.error(`Unsupported macOS packaging architecture: ${process.arch}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const builder = resolve(
  dirname(require.resolve("electron-builder/package.json")),
  "cli.js",
);
const extraArgs = process.argv.slice(2);
const publishArgs = extraArgs.some((argument) =>
  argument.startsWith("--publish"),
)
  ? []
  : ["--publish", "never"];
const result = spawnSync(
  process.execPath,
  [builder, "--mac", `--${process.arch}`, ...publishArgs, ...extraArgs],
  { stdio: "inherit" },
);
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
