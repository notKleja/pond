import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, shell } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserExtension } from "./browser-extension";

describe("installBrowserExtension", () => {
  let root: string;
  let downloads: string;
  const showItemInFolder = vi.fn();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pond-extension-"));
    downloads = join(root, "Downloads");
    mkdirSync(join(root, "desktop"));
    mkdirSync(downloads);
    Object.assign(app, {
      getAppPath: () => join(root, "desktop"),
      getPath: () => downloads,
    });
    Object.assign(shell, { showItemInFolder });
    showItemInFolder.mockClear();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("replaces the Downloads copy with the built extension and reveals it", async () => {
    const build = join(root, "extension", ".output", "chrome-mv3");
    mkdirSync(build, { recursive: true });
    writeFileSync(join(build, "manifest.json"), "{}");
    const target = join(downloads, "Pond Extension");
    mkdirSync(target);
    writeFileSync(join(target, "stale.js"), "");

    await expect(installBrowserExtension()).resolves.toEqual({
      ok: true,
      path: target,
    });
    expect(existsSync(join(target, "manifest.json"))).toBe(true);
    expect(existsSync(join(target, "stale.js"))).toBe(false);
    expect(showItemInFolder).toHaveBeenCalledWith(target);
  });

  it("copies the Firefox build to its own Downloads folder", async () => {
    const build = join(root, "extension", ".output", "firefox-mv3");
    mkdirSync(build, { recursive: true });
    writeFileSync(join(build, "manifest.json"), "{}");

    await expect(installBrowserExtension("firefox")).resolves.toEqual({
      ok: true,
      path: join(downloads, "Pond Extension Firefox"),
    });
    expect(
      existsSync(join(downloads, "Pond Extension Firefox", "manifest.json")),
    ).toBe(true);
  });

  it("fails without touching Downloads when no build exists", async () => {
    const result = await installBrowserExtension();
    expect(result.ok).toBe(false);
    expect(existsSync(join(downloads, "Pond Extension"))).toBe(false);
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});
