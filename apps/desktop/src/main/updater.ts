import { app } from "electron";
import log from "electron-log/main.js";
import { IPC } from "../shared/constants";
import type { OkResult, ReasonFailure } from "../shared/query-contracts-shared";
import type { UpdateNotice } from "../shared/update-notice";
import { getPrefs } from "./core/prefs";
import {
  createUpdaterCoordinator,
  type UpdaterPort,
} from "./core/updater-coordinator";
import { broadcast } from "./lib/broadcast";

let wired = false;

async function loadUpdater(): Promise<UpdaterPort> {
  const { default: electronUpdaterPkg } = await import("electron-updater");
  const autoUpdater = electronUpdaterPkg.autoUpdater;
  autoUpdater.logger = log;
  return {
    autoDownload: () => autoUpdater.autoDownload,
    setAllowPrerelease: (value) => {
      autoUpdater.allowPrerelease = value;
    },
    setAutoDownload: (value) => {
      autoUpdater.autoDownload = value;
    },
    setAutoInstallOnQuit: (value) => {
      autoUpdater.autoInstallOnAppQuit = value;
    },
    onAvailable: (listener) => {
      autoUpdater.on("update-available", (info) => listener(info.version));
    },
    onNotAvailable: (listener) => {
      autoUpdater.on("update-not-available", listener);
    },
    onError: (listener) => {
      autoUpdater.on("error", (error) => listener(error));
    },
    onDownloaded: (listener) => {
      autoUpdater.on("update-downloaded", (info) => listener(info.version));
    },
    check: async () => {
      const result = await autoUpdater.checkForUpdates();
      return result ? { version: result.updateInfo.version } : null;
    },
    download: async () => {
      await autoUpdater.downloadUpdate();
    },
    install: () => {
      autoUpdater.quitAndInstall();
    },
  };
}

const updater = createUpdaterCoordinator({
  isPackaged: () => app.isPackaged,
  loadUpdater,
  loadAutoInstallPreference: async () => (await getPrefs()).updates.autoInstall,
  publish: (notice) => broadcast(IPC.updateNotice, notice),
  scheduleTimeout: (callback, delay) => {
    setTimeout(callback, delay);
  },
  scheduleInterval: (callback, delay) => {
    setInterval(callback, delay);
  },
  info: (message, value) => log.info(message, value),
  warn: (message, error) => log.warn(message, error),
});

export function registerAutoUpdater(): void {
  if (wired) return;
  if (!app.isPackaged) {
    log.info("[pond updater] skipped (dev build)");
    return;
  }
  wired = true;
  void updater.start().catch((error) => {
    wired = false;
    log.warn("[pond updater] setup failed", error);
  });
}

export function applyUpdaterPrefs(): Promise<void> {
  return updater.applyPrefs();
}

export function currentUpdateNotice(): UpdateNotice | null {
  return updater.currentNotice();
}

export function downloadAvailableUpdate(): Promise<
  OkResult | ReasonFailure<"dev_build">
> {
  return updater.download();
}

export function installDownloadedUpdate(): Promise<
  OkResult | ReasonFailure<"dev_build">
> {
  return updater.install();
}

export function checkForUpdatesNow(): Promise<
  OkResult<{ version?: string }> | ReasonFailure<"dev_build">
> {
  return updater.checkNow();
}
