import { z } from "zod";
import {
  type DownloadRow,
  statusFeed,
} from "@/features/downloads/lib/status-feed";
import { downloadsSelection } from "@/features/downloads/state/downloads-selection";
import {
  invalidatePendingSaveHydration,
  pool,
  reloadSaves,
  trashSaves,
} from "@/features/saves/pool";
import { emitFeedback } from "@/shared/lib/sounds";
import { notify } from "@/shared/lib/toast";

const RetryResultSchema = z.object({ ok: z.boolean(), requeued: z.number() });
const SkipResultSchema = z.object({ ok: z.boolean(), skipped: z.number() });
const ClearUnfinishedResultSchema = z.object({
  changed: z.number().int().nonnegative(),
  ids: z.array(z.string()),
});
type ClearUnfinishedResult = z.infer<typeof ClearUnfinishedResultSchema>;

export function canSkipDownload(row: DownloadRow): boolean {
  return row.live && row.status !== "complete" && row.status !== "skipped";
}

export function canTrashDownload(row: DownloadRow): boolean {
  return row.live && row.status !== "complete";
}

export function canCancelDownload(row: DownloadRow): boolean {
  return row.live && row.status !== "failed";
}

export async function retryDownloadRows(
  rows: readonly DownloadRow[],
): Promise<boolean> {
  const ids = rows.filter((r) => r.status === "failed").map((r) => r.saveId);
  if (ids.length === 0) return false;
  const result = RetryResultSchema.parse(
    await window.pond.query("saves.retryFailed", { ids }),
  );
  if (!result.ok || result.requeued === 0) {
    statusFeed.error("Retry failed items", "Couldn't retry failed items.");
    return false;
  }
  return true;
}

export function cancelDownloadRows(rows: readonly DownloadRow[]): void {
  const live = rows.filter(canCancelDownload);
  if (live.length === 0) return;
  void Promise.all(
    live.map((row) => window.pond.pipelineCancelSave(row.saveId)),
  ).then(() => downloadsSelection.clear());
}

export function skipDownloadRows(rows: readonly DownloadRow[]): void {
  const ids = [
    ...new Set(rows.filter(canSkipDownload).map((row) => row.saveId)),
  ];
  if (ids.length === 0) return;
  void window.pond
    .query("saves.skipIngest", { ids })
    .then((value) => {
      const result = SkipResultSchema.parse(value);
      if (!result.ok || result.skipped === 0) throw new Error("skip failed");
      downloadsSelection.clear();
    })
    .catch(() =>
      statusFeed.error(
        "Skip downloads",
        "Couldn't skip these downloads. Try again.",
      ),
    );
}

interface TrashNotificationDependencies {
  notify: typeof notify;
  undo: () => Promise<{ ok: boolean }>;
}

interface TrashDownloadDependencies extends TrashNotificationDependencies {
  trash: typeof trashSaves;
}

interface ClearUnfinishedDependencies extends TrashNotificationDependencies {
  clear: () => Promise<ClearUnfinishedResult>;
  invalidate: (ids: readonly string[]) => void;
  reconcile: (ids: readonly string[]) => void;
  reload: (ids: readonly string[]) => Promise<void>;
}

const TRASH_DOWNLOAD_DEPENDENCIES: TrashDownloadDependencies = {
  trash: trashSaves,
  notify,
  undo: () => window.pond.undo(),
};

const CLEAR_UNFINISHED_DEPENDENCIES: ClearUnfinishedDependencies = {
  notify,
  undo: () => window.pond.undo(),
  clear: async () =>
    ClearUnfinishedResultSchema.parse(
      await window.pond.query("downloads.clearUnfinished", {}),
    ),
  invalidate: invalidatePendingSaveHydration,
  reload: reloadSaves,
  reconcile: (ids) => {
    const deletedAt = Date.now();
    for (const id of ids) {
      const save = pool.get(id);
      if (save) pool.upsert({ ...save, deletedAt });
    }
    emitFeedback("saveDeletion");
  },
};

function reportUndoFailure(): void {
  statusFeed.error(
    "Undo move to Trash",
    "Couldn't restore these downloads. Try again.",
  );
}

function notifyTrashedDownloads(
  changed: number,
  dependencies: TrashNotificationDependencies,
  afterUndo?: () => Promise<void>,
): void {
  downloadsSelection.clear();
  dependencies.notify({
    id: "trash-downloads",
    title:
      changed === 1
        ? "Moved download to Trash"
        : `Moved ${changed} downloads to Trash`,
    action: {
      label: "Undo",
      onClick: () => {
        void dependencies
          .undo()
          .then(async (result) => {
            if (!result.ok) {
              reportUndoFailure();
              return;
            }
            await afterUndo?.();
          })
          .catch(reportUndoFailure);
      },
    },
  });
}

async function trashDownloadIds(
  ids: readonly string[],
  dependencies: TrashDownloadDependencies,
): Promise<boolean> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return false;
  try {
    const changed = await dependencies.trash(uniqueIds);
    if (changed === 0) return false;
    notifyTrashedDownloads(changed, dependencies);
    return true;
  } catch {
    statusFeed.error(
      "Move to Trash",
      "Couldn't move these downloads to Trash. Try again.",
    );
    return false;
  }
}

export async function clearUnfinishedDownloads(
  dependencies = CLEAR_UNFINISHED_DEPENDENCIES,
): Promise<boolean> {
  try {
    const result = await dependencies.clear();
    if (result.changed === 0) return false;
    dependencies.invalidate(result.ids);
    dependencies.reconcile(result.ids);
    notifyTrashedDownloads(result.changed, dependencies, async () => {
      dependencies.invalidate(result.ids);
      await dependencies.reload(result.ids);
    });
    return true;
  } catch {
    statusFeed.error(
      "Move to Trash",
      "Couldn't move these downloads to Trash. Try again.",
    );
    return false;
  }
}

export function trashDownloadRows(
  rows: readonly DownloadRow[],
  dependencies = TRASH_DOWNLOAD_DEPENDENCIES,
): void {
  const ids = rows.filter(canTrashDownload).map((row) => row.saveId);
  void trashDownloadIds(ids, dependencies);
}
