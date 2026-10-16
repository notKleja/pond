import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { app, shell } from "electron";
import log from "electron-log/main.js";
import type { ExtensionBrowser } from "../../shared/browser-extension-contracts";
import type { QueryResult } from "../../shared/query-contracts";

const TARGETS = {
  chrome: {
    folder: "Pond Extension",
    output: "chrome-mv3",
    resource: "extension",
  },
  firefox: {
    folder: "Pond Extension Firefox",
    output: "firefox-mv3",
    resource: "extension-firefox",
  },
} as const;

function bundledExtensionDir(target: ExtensionBrowser): string | null {
  const spec = TARGETS[target];
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, spec.resource)]
    : [join(app.getAppPath(), "..", "extension", ".output", spec.output)];
  return (
    candidates.find((dir) => existsSync(join(dir, "manifest.json"))) ?? null
  );
}

/** Unpacked copies stay at one Downloads path so the browser can reload the same folder. */
export async function installBrowserExtension(
  target: ExtensionBrowser = "chrome",
): Promise<QueryResult<"extension.install">> {
  const source = bundledExtensionDir(target);
  if (!source) {
    return {
      ok: false,
      error: app.isPackaged
        ? "This copy of Pond is missing the extension. Reinstall Pond and try again."
        : "Build the extension first, then try again.",
    };
  }
  const destination = join(app.getPath("downloads"), TARGETS[target].folder);
  try {
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  } catch (err) {
    log.warn("[pond extension] copy failed", err);
    return {
      ok: false,
      error: "Pond couldn't save the extension to Downloads. Try again.",
    };
  }
  shell.showItemInFolder(destination);
  return { ok: true, path: destination };
}
