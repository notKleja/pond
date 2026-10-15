import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeMacUpdateMetadata } from "./write-mac-update-metadata.mjs";

test("writes one update manifest for native arm64 and x64 packages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pond-mac-metadata-"));
  try {
    await writeFile(join(directory, "Pond-1.2.3-arm64.zip"), "arm64");
    await writeFile(join(directory, "Pond-1.2.3-x64.zip"), "x64");
    const now = new Date("2026-10-15T12:00:00.000Z");
    const { output, content } = await writeMacUpdateMetadata(
      directory,
      "1.2.3",
      now,
    );
    assert.equal(await readFile(output, "utf8"), content);
    assert.match(content, /url: Pond-1\.2\.3-arm64\.zip/);
    assert.match(content, /url: Pond-1\.2\.3-x64\.zip/);
    assert.match(content, /path: Pond-1\.2\.3-x64\.zip/);
    assert.match(content, /releaseDate: '2026-10-15T12:00:00\.000Z'/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
