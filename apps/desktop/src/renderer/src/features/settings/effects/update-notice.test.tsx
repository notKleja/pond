import type { QueryResult } from "@shared/query-contracts";
import { describe, expect, it, vi } from "vitest";
import type { NotifyOptions } from "@/shared/lib/toast";
import { presentUpdateNotice, subscribeToUpdateNotices } from "./update-notice";

function createDependencies() {
  const notifications: NotifyOptions[] = [];
  const runAction = vi.fn<
    (
      name: "updates.download" | "updates.install",
    ) => Promise<QueryResult<"updates.download" | "updates.install">>
  >(async () => ({ ok: true }));
  return {
    dependencies: {
      notify: (options: NotifyOptions) => {
        notifications.push(options);
        return options.id;
      },
      runAction,
    },
    notifications,
    runAction,
  };
}

describe("presentUpdateNotice", () => {
  it("downloads from the available toast", () => {
    const { dependencies, notifications, runAction } = createDependencies();
    presentUpdateNotice(
      {
        phase: "available",
        version: "1.0.2",
        downloading: false,
      },
      dependencies,
    );
    const toast = notifications[0];
    toast?.action?.onClick();
    expect(runAction).toHaveBeenCalledWith("updates.download");
  });

  it("restarts from the ready toast", () => {
    const { dependencies, notifications, runAction } = createDependencies();
    presentUpdateNotice(
      { phase: "downloaded", version: "1.0.2" },
      dependencies,
    );
    const toast = notifications[0];
    toast?.action?.onClick();
    expect(runAction).toHaveBeenCalledWith("updates.install");
  });

  it("surfaces update action failures", async () => {
    const { dependencies, notifications, runAction } = createDependencies();
    runAction.mockResolvedValue({ ok: false, error: "Network unavailable" });
    presentUpdateNotice(
      { phase: "available", version: "1.0.2", downloading: false },
      dependencies,
    );

    notifications[0]?.action?.onClick();
    await vi.waitFor(() => expect(notifications).toHaveLength(2));
    expect(notifications[1]).toMatchObject({
      id: "update-failed",
      description: "Network unavailable",
    });
  });
});

describe("subscribeToUpdateNotices", () => {
  it("presents a cached notice when no event is emitted", async () => {
    const notice = {
      phase: "downloaded" as const,
      version: "1.0.2",
    };
    const present = vi.fn();
    const stop = subscribeToUpdateNotices({
      current: async () => notice,
      present,
      subscribe: () => vi.fn(),
      warn: vi.fn(),
    });

    await vi.waitFor(() => expect(present).toHaveBeenCalledWith(notice));
    stop();
  });

  it("pulls a cached notice after subscribing and deduplicates the event race", async () => {
    const notice = {
      phase: "downloaded" as const,
      version: "1.0.2",
    };
    let listener: ((value: typeof notice) => void) | undefined;
    const present = vi.fn();
    const unsubscribe = vi.fn();
    const stop = subscribeToUpdateNotices({
      current: async () => notice,
      present,
      subscribe: (next) => {
        listener = next;
        return unsubscribe;
      },
      warn: vi.fn(),
    });

    listener?.(notice);
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
