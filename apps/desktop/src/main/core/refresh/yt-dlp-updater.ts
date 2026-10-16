import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import log from "electron-log/main.js";
import { z } from "zod";
import { killProcessTree } from "../../lib/process-tree";
import {
  invalidateBinariesCache,
  userBinDir,
  YTDLP_FILENAME,
} from "./binaries";

const REPO = "yt-dlp/yt-dlp";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ReleaseSchema = z.object({
  tag_name: z.string().optional().catch(undefined),
});

const SMOKE_TIMEOUT_MS = 20_000;
const RENAME_ATTEMPTS = 5;
/** Windows briefly locks a fresh exe while Defender scans it or a job still runs it. */
const RETRYABLE_RENAME_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

const ASSET_BY_PLATFORM = new Map<string, string>(
  Object.entries({
    darwin: "yt-dlp_macos",
    linux: "yt-dlp_linux",
    win32: "yt-dlp.exe",
  }),
);

const VERSION_FILE = ".yt-dlp-version";
const VERSION_PREVIOUS_FILE = ".yt-dlp-version.previous";
const PREVIOUS_FILENAME = `${YTDLP_FILENAME}.previous`;
const LAST_CHECK_FILE = ".yt-dlp-last-check";

let inFlight: Promise<void> | null = null;

export function maybeUpdateYtDlp(
  opts: { force?: boolean } = {},
): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runUpdate(opts.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runUpdate(force: boolean): Promise<void> {
  const asset = ASSET_BY_PLATFORM.get(process.platform);
  if (!asset) return;

  const dir = userBinDir();
  const active = join(dir, YTDLP_FILENAME);
  const previous = join(dir, PREVIOUS_FILENAME);

  try {
    await healthCheckAndRollback(dir, active, previous);

    if (!force && (await checkedRecently(dir))) return;

    const tag = await fetchLatestTag();
    if (!tag) return;

    const installedTag = await readText(join(dir, VERSION_FILE));
    if (installedTag === tag && existsSync(active)) {
      await markChecked(dir);
      return;
    }

    const expectedSha = await fetchExpectedSha(tag, asset);
    if (!expectedSha) {
      log.warn("[pond yt-dlp-update] no sha for asset in SHA2-256SUMS", asset);
      return;
    }

    const buf = await fetchBinary(assetUrl(tag, asset));
    const actualSha = createHash("sha256").update(buf).digest("hex");
    if (actualSha !== expectedSha) {
      log.warn("[pond yt-dlp-update] sha256 mismatch, refusing", {
        asset,
        expected: expectedSha,
        actual: actualSha,
      });
      return;
    }

    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${YTDLP_FILENAME}.${process.pid}.tmp`);
    await writeFile(tmp, buf);
    if (process.platform !== "win32") await chmod(tmp, 0o755);

    if (!(await smokeTest(tmp))) {
      log.warn("[pond yt-dlp-update] downloaded binary failed --version");
      await rm(tmp, { force: true });
      return;
    }

    if (existsSync(active)) await rotateToPrevious(dir, active, previous);
    try {
      await renameWithRetry(tmp, active);
    } catch (err) {
      await rm(tmp, { force: true });
      if (!existsSync(active) && existsSync(previous)) {
        await renameWithRetry(previous, active);
        invalidateBinariesCache();
      }
      throw err;
    }
    await writeFile(join(dir, VERSION_FILE), tag, "utf8");
    invalidateBinariesCache();
    await markChecked(dir);
    log.info("[pond yt-dlp-update] updated to", tag);
  } catch (err) {
    log.warn("[pond yt-dlp-update] check failed", err);
  }
}

async function healthCheckAndRollback(
  dir: string,
  active: string,
  previous: string,
): Promise<void> {
  if (!existsSync(active)) {
    if (existsSync(previous)) await restorePrevious(dir, active, previous);
    return;
  }
  if (await smokeTest(active)) return;
  if (!existsSync(previous)) {
    log.warn("[pond yt-dlp-update] active binary failed --version, no backup");
    return;
  }
  await restorePrevious(dir, active, previous);
}

async function restorePrevious(
  dir: string,
  active: string,
  previous: string,
): Promise<void> {
  await rm(active, { force: true });
  await renameWithRetry(previous, active);

  const prevVersion = await readText(join(dir, VERSION_PREVIOUS_FILE));
  if (prevVersion) {
    await writeFile(join(dir, VERSION_FILE), prevVersion, "utf8");
  } else {
    await rm(join(dir, VERSION_FILE), { force: true });
  }
  await rm(join(dir, VERSION_PREVIOUS_FILE), { force: true });

  invalidateBinariesCache();
  log.warn("[pond yt-dlp-update] active binary broken, rolled back", {
    restored: prevVersion,
  });
}

async function rotateToPrevious(
  dir: string,
  active: string,
  previous: string,
): Promise<void> {
  const currentVersion = await readText(join(dir, VERSION_FILE));
  await rm(previous, { force: true });
  await renameWithRetry(active, previous);
  if (currentVersion) {
    await writeFile(join(dir, VERSION_PREVIOUS_FILE), currentVersion, "utf8");
  } else {
    await rm(join(dir, VERSION_PREVIOUS_FILE), { force: true });
  }
}

export async function renameWithRetry(
  from: string,
  to: string,
  deps: {
    rename?: (from: string, to: string) => Promise<void>;
    platform?: NodeJS.Platform;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const {
    rename: move = rename,
    platform = process.platform,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = deps;
  for (let attempt = 1; ; attempt++) {
    try {
      return await move(from, to);
    } catch (err) {
      const code = z.object({ code: z.string() }).safeParse(err).data?.code;
      const retry =
        platform === "win32" &&
        attempt < RENAME_ATTEMPTS &&
        code !== undefined &&
        RETRYABLE_RENAME_CODES.has(code);
      if (!retry) throw err;
      await sleep(Math.min(500, 100 * attempt));
    }
  }
}

async function fetchLatestTag(): Promise<string | null> {
  const res = await fetch(LATEST_API, {
    headers: {
      "user-agent": "pond-desktop",
      accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    log.debug("[pond yt-dlp-update] latest release lookup", res.status);
    return null;
  }
  const json = ReleaseSchema.safeParse(await res.json());
  return json.data?.tag_name ?? null;
}

async function fetchExpectedSha(
  tag: string,
  asset: string,
): Promise<string | null> {
  const res = await fetch(assetUrl(tag, "SHA2-256SUMS"), {
    redirect: "follow",
    headers: { "user-agent": "pond-desktop" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  for (const line of text.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === asset && sha) return sha.toLowerCase();
  }
  return null;
}

async function fetchBinary(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "pond-desktop" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function assetUrl(tag: string, asset: string): string {
  return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
}

function smokeTest(binaryPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try {
        killProcessTree(child, "SIGKILL");
      } catch {}
      resolve(false);
    }, SMOKE_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function checkedRecently(dir: string): Promise<boolean> {
  const last = await readText(join(dir, LAST_CHECK_FILE));
  if (!last) return false;
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < CHECK_INTERVAL_MS;
}

async function markChecked(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, LAST_CHECK_FILE), new Date().toISOString());
  } catch {}
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}
