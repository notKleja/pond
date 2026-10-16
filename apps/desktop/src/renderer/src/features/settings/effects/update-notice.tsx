import type { QueryResult } from "@shared/query-contracts";
import { type UpdateNotice, UpdateNoticeSchema } from "@shared/update-notice";
import { useEffect } from "react";
import { type NotifyOptions, notify } from "@/shared/lib/toast";
import { updateNoticeCopy } from "./update-notice-copy";

type UpdateAction = "updates.download" | "updates.install";
type UpdateActionResult = QueryResult<UpdateAction>;

interface UpdateNoticeDependencies {
  notify: (options: NotifyOptions) => string;
  runAction: (name: UpdateAction) => Promise<UpdateActionResult>;
}

const defaultDependencies: UpdateNoticeDependencies = {
  notify,
  runAction: (name) => window.pond.query(name, {}),
};

interface UpdateNoticeSubscriptionDependencies {
  current(): Promise<UpdateNotice | null>;
  present(notice: UpdateNotice): void;
  subscribe(listener: (notice: UpdateNotice) => void): () => void;
  warn(error: Error): void;
}

const defaultSubscriptionDependencies: UpdateNoticeSubscriptionDependencies = {
  current: async () => {
    const result = await window.pond.query("updates.currentNotice", {});
    return UpdateNoticeSchema.nullable().parse(result);
  },
  present: presentUpdateNotice,
  subscribe: (listener) => window.pond.onUpdateNotice(listener),
  warn: (error) => console.warn("[pond updater] replay failed", error),
};

export function UpdateNoticeBridge() {
  useEffect(() => {
    return subscribeToUpdateNotices();
  }, []);

  return null;
}

export function subscribeToUpdateNotices(
  dependencies: UpdateNoticeSubscriptionDependencies = defaultSubscriptionDependencies,
): () => void {
  let active = true;
  let lastNotice = "";
  const present = (notice: UpdateNotice) => {
    const key = `${notice.phase}:${notice.version}:${"downloading" in notice ? notice.downloading : ""}`;
    if (key === lastNotice) return;
    lastNotice = key;
    dependencies.present(notice);
  };
  const unsubscribe = dependencies.subscribe(present);
  void dependencies
    .current()
    .then((notice) => {
      if (active && notice) present(notice);
    })
    .catch((error) => {
      dependencies.warn(
        error instanceof Error ? error : new Error("Unknown updater error"),
      );
    });
  return () => {
    active = false;
    unsubscribe();
  };
}

export function presentUpdateNotice(
  notice: UpdateNotice,
  dependencies: UpdateNoticeDependencies = defaultDependencies,
): void {
  const copy = updateNoticeCopy(notice);
  dependencies.notify({
    id: notice.phase === "downloaded" ? "update-ready" : "update-available",
    title: copy.title,
    description: copy.description,
    timeout: notice.phase === "downloaded" ? 60_000 : 8_000,
    action: copy.action
      ? {
          label: copy.action,
          onClick: () => {
            const name =
              notice.phase === "downloaded"
                ? "updates.install"
                : "updates.download";
            void runUpdateAction(name, dependencies);
          },
        }
      : undefined,
  });
}

async function runUpdateAction(
  name: UpdateAction,
  dependencies: UpdateNoticeDependencies,
): Promise<void> {
  try {
    const result = await dependencies.runAction(name);
    if (result.ok) return;
    dependencies.notify({
      id: "update-failed",
      title:
        name === "updates.install"
          ? "Couldn't restart"
          : "Couldn't download update",
      description:
        result.error ??
        (result.reason === "dev_build"
          ? "Updates aren't available in development builds."
          : "Something went wrong. Try again."),
    });
  } catch (error) {
    dependencies.notify({
      id: "update-failed",
      title:
        name === "updates.install"
          ? "Couldn't restart"
          : "Couldn't download update",
      description:
        error instanceof Error
          ? error.message
          : "Something went wrong. Try again.",
    });
  }
}
