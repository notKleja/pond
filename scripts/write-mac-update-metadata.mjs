#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function fileInfo(directory, name) {
  const path = join(directory, name);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {
    name,
    sha512: hash.digest("base64"),
    size: (await stat(path)).size,
  };
}

export async function writeMacUpdateMetadata(
  directory,
  version,
  now = new Date(),
) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("The macOS update version must use X.Y.Z.");
  const root = resolve(directory);
  const arm64 = await fileInfo(root, `Pond-${version}-arm64.zip`);
  const x64 = await fileInfo(root, `Pond-${version}-x64.zip`);
  const content = [
    `version: ${version}`,
    "files:",
    `  - url: ${arm64.name}`,
    `    sha512: ${arm64.sha512}`,
    `    size: ${arm64.size}`,
    `  - url: ${x64.name}`,
    `    sha512: ${x64.sha512}`,
    `    size: ${x64.size}`,
    `path: ${x64.name}`,
    `sha512: ${x64.sha512}`,
    `releaseDate: '${now.toISOString()}'`,
    "",
  ].join("\n");
  const output = join(root, "latest-mac.yml");
  await writeFile(output, content, "utf8");
  return { output, content };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const [, , directory, version] = process.argv;
  if (!directory || !version)
    throw new Error(
      "Usage: node scripts/write-mac-update-metadata.mjs <directory> <version>",
    );
  const result = await writeMacUpdateMetadata(directory, version);
  console.log(`Wrote ${result.output}`);
}
