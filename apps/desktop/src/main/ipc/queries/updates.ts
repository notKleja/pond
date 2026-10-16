import type { QueryResult } from "../../../shared/query-contracts";
import type { QueryHandlerMap } from "./params";

export const updateQueries = {
  async "updates.currentNotice"(): Promise<
    QueryResult<"updates.currentNotice">
  > {
    const { currentUpdateNotice } = await import("../../updater");
    return currentUpdateNotice();
  },

  async "updates.applyPrefs"(): Promise<QueryResult<"updates.applyPrefs">> {
    try {
      const { applyUpdaterPrefs } = await import("../../updater");
      await applyUpdaterPrefs();
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong. Try again.",
      };
    }
  },

  async "updates.checkNow"(): Promise<QueryResult<"updates.checkNow">> {
    const { checkForUpdatesNow } = await import("../../updater");
    return checkForUpdatesNow();
  },

  async "updates.download"(): Promise<QueryResult<"updates.download">> {
    const { downloadAvailableUpdate } = await import("../../updater");
    return downloadAvailableUpdate();
  },

  async "updates.install"(): Promise<QueryResult<"updates.install">> {
    const { installDownloadedUpdate } = await import("../../updater");
    return installDownloadedUpdate();
  },
} satisfies QueryHandlerMap;
