import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXTENSION_ID, NATIVE_HOST_NAME } from "@pond/schema/native";
import { app } from "electron";
import log from "electron-log/main.js";

const HOST_FILENAME = `${NATIVE_HOST_NAME}.json`;

const MAC_BROWSER_NMH_DIRS = [
  "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  "Library/Application Support/Google/Chrome Canary/NativeMessagingHosts",
  "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts",
  "Library/Application Support/Chromium/NativeMessagingHosts",
  "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
  "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
  "Library/Application Support/Arc/User Data/NativeMessagingHosts",
  "Library/Application Support/Vivaldi/NativeMessagingHosts",
] as const;

export const WINDOWS_NATIVE_MESSAGING_REGISTRY_KEYS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Google\\Chrome Beta\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Google\\Chrome Dev\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Google\\Chrome SxS\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  `HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
] as const;

export function nativeHostFilename(platform: NodeJS.Platform): string {
  return platform === "win32" ? "pond-native-host.exe" : "pond-native-host";
}

function nativeHostBinaryPath(
  platform: NodeJS.Platform = process.platform,
): string {
  const filename = nativeHostFilename(platform);
  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", filename);
  }
  const candidates = [
    join(app.getAppPath(), "resources", "bin", filename),
    join(app.getAppPath(), "..", "resources", "bin", filename),
    join(process.cwd(), "resources", "bin", filename),
  ];
  const found = candidates.find((p) => existsSync(p));
  return found ?? join(process.cwd(), "resources", "bin", filename);
}

export function manifestBody(hostPath: string): string {
  return `${JSON.stringify(
    {
      name: NATIVE_HOST_NAME,
      description: "Pond",
      path: hostPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2,
  )}\n`;
}

export function windowsRegistryArgs(
  key: string,
  manifestPath: string,
): string[] {
  return ["ADD", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"];
}

export function writeNativeHostManifests(): void {
  if (process.platform !== "darwin" && process.platform !== "win32") return;

  const hostPath = nativeHostBinaryPath();
  if (!existsSync(hostPath)) {
    log.warn("[pond native] host binary missing", hostPath);
    return;
  }

  if (process.platform === "win32") {
    writeWindowsNativeHostManifest(hostPath);
    return;
  }

  const home = homedir();
  const body = manifestBody(hostPath);
  for (const rel of MAC_BROWSER_NMH_DIRS) {
    const parent = join(home, rel, "..");
    if (!existsSync(parent)) continue;
    const dir = join(home, rel);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, HOST_FILENAME), body, { encoding: "utf8" });
    } catch (err) {
      log.warn("[pond native] failed to write host manifest", dir, err);
    }
  }
}

function writeWindowsNativeHostManifest(hostPath: string): void {
  const dir = join(app.getPath("userData"), "native-messaging");
  const manifestPath = join(dir, HOST_FILENAME);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(manifestPath, manifestBody(hostPath), { encoding: "utf8" });
  } catch (err) {
    log.warn("[pond native] failed to write host manifest", manifestPath, err);
    return;
  }

  for (const key of WINDOWS_NATIVE_MESSAGING_REGISTRY_KEYS) {
    try {
      execFileSync("reg.exe", windowsRegistryArgs(key, manifestPath), {
        windowsHide: true,
      });
    } catch (err) {
      log.warn("[pond native] failed to register host manifest", key, err);
    }
  }
}
