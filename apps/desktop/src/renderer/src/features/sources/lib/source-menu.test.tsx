import type { MenuItemSpec } from "@pond/ui";
import { Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardModel } from "@/features/sources/components/sync-monitor/lib/helpers";
import type { AccountRow } from "@/features/sources/hooks/use-accounts";
import type { WatchRow } from "@/features/sources/hooks/use-watches";
import { sourceFlow } from "@/features/sources/state/source-flow";
import {
  accountMenuTarget,
  buildSourceActionMenu,
  watchMenuTarget,
} from "./source-menu";

const ready: CardModel = {
  tone: "ok",
  statusText: "Synced",
  connected: true,
  meta: "Manual",
  lastText: "3 minutes ago",
};

function labelText(label: ReactNode): string | null {
  const labels = Children.toArray(label);
  const value = labels.length === 1 ? labels[0] : null;
  return value != null && !isValidElement(value) ? String(value) : null;
}

function account(model = ready): ReturnType<typeof accountMenuTarget> {
  const row: AccountRow = {
    id: "acc-instagram",
    source: "instagram",
    handle: "oluwa.rafa",
    label: null,
    avatarUrl: null,
    addedAt: "",
    sync: { lastSyncedAt: null, lastError: null, knownCount: 4224 },
    connected: model.connected,
    syncing: model.tone === "run",
  };
  return accountMenuTarget(row, model);
}

function watch(model = ready): ReturnType<typeof watchMenuTarget> {
  const row: WatchRow = {
    id: "watch-twitter",
    source: "twitter",
    handle: "12345",
    kind: "list",
    label: null,
    avatarUrl: null,
    via: null,
    addedAt: "",
    sync: { lastSyncedAt: null, lastError: null, knownCount: 8 },
    syncing: model.tone === "run",
  };
  return watchMenuTarget(row, model);
}

function groupItems(items: MenuItemSpec[]): string[][] {
  return items.flatMap((item) => {
    if (item.type !== "group") return [];
    return [
      item.items.flatMap((child) => {
        if (!("label" in child) || child.hidden) return [];
        const label = labelText(child.label);
        return label ? [label] : [];
      }),
    ];
  });
}

function expectUntitledGroups(items: MenuItemSpec[]): void {
  expect(
    items
      .filter((item) => item.type === "group")
      .every((item) => item.label == null),
  ).toBe(true);
}

function groups(items: MenuItemSpec[]): string[][] {
  expectUntitledGroups(items);
  return groupItems(items);
}

function fetchGroup(items: MenuItemSpec[]): string[] {
  return (
    groupItems(items).find((labels) =>
      labels.some((label) => /Fetch$|Fetch /.test(label)),
    ) ?? []
  );
}

function findItem(items: MenuItemSpec[], label: string): MenuItemSpec | null {
  for (const item of items) {
    if ("label" in item && item.label === label) return item;
    if (item.type === "group" || item.type === "submenu") {
      const child = findItem(item.items, label);
      if (child) return child;
    }
  }
  return null;
}

function nextNotification(): Promise<{ title: string; description?: string }> {
  return new Promise((resolve) => {
    window.addEventListener(
      "pond:notification",
      (event) => {
        if (!(event instanceof CustomEvent)) return;
        resolve(event.detail);
      },
      { once: true },
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("pond", {
    clearPendingSession: vi.fn(async () => undefined),
    connectSource: vi.fn(async () => ({ ok: true })),
    openExternal: vi.fn(async () => ({ ok: true })),
    refreshBackfillStart: vi.fn(async () => ({ ok: true })),
    syncCancel: vi.fn(async () => ({ ok: true, running: false })),
    syncRunNow: vi.fn(async () => ({ ok: true })),
    query: vi.fn(async () => ({ ok: true })),
  });
});

afterEach(() => {
  sourceFlow.close();
  vi.unstubAllGlobals();
});

describe("buildSourceActionMenu", () => {
  it("separates a connected account menu without group titles", () => {
    expect(groups(buildSourceActionMenu(account()))).toEqual([
      ["Open Instagram Profile", "Show Saved Items"],
      ["Copy Profile Link", "Copy Username", "Copy Connection ID"],
      [
        "Fetch New Saves",
        "Fetch Older Saves",
        "Fetch Save Details",
        "Fetch Original Media",
      ],
      ["Sign In Again", "Disconnect Instagram"],
    ]);
  });

  it("marks connection removal as destructive", () => {
    expect(
      findItem(buildSourceActionMenu(account()), "Disconnect Instagram"),
    ).toMatchObject({ variant: "destructive" });
    expect(
      findItem(buildSourceActionMenu(watch()), "Stop Watching"),
    ).toMatchObject({ variant: "destructive" });
  });

  it("opens profiles and copies profile details through Pond bridges", async () => {
    const items = buildSourceActionMenu(account());
    const open = findItem(items, "Open Instagram Profile");
    const copyLink = findItem(items, "Copy Profile Link");
    const copyUsername = findItem(items, "Copy Username");
    const copyId = findItem(items, "Copy Connection ID");
    if (
      !open ||
      !copyLink ||
      !copyUsername ||
      !copyId ||
      !("onClick" in open) ||
      !("onClick" in copyLink) ||
      !("onClick" in copyUsername) ||
      !("onClick" in copyId)
    ) {
      throw new Error("Missing profile actions");
    }

    open.onClick?.();
    copyLink.onClick?.();
    copyUsername.onClick?.();
    copyId.onClick?.();
    await vi.waitFor(() => {
      expect(window.pond.openExternal).toHaveBeenCalledWith(
        "https://www.instagram.com/oluwa.rafa/",
      );
      expect(window.pond.query).toHaveBeenCalledWith("clipboard.writeText", {
        text: "https://www.instagram.com/oluwa.rafa/",
      });
      expect(window.pond.query).toHaveBeenCalledWith("clipboard.writeText", {
        text: "oluwa.rafa",
      });
      expect(window.pond.query).toHaveBeenCalledWith("clipboard.writeText", {
        text: "acc-instagram",
      });
    });
  });

  it("adapts fetch actions to running and failed states", () => {
    const running = account({ ...ready, tone: "run" });
    expect(fetchGroup(buildSourceActionMenu(running))[0]).toBe("Cancel Fetch");

    const failed = account({ ...ready, tone: "err" });
    failed.lastError = "Session expired";
    expect(fetchGroup(buildSourceActionMenu(failed))).toEqual([
      "Retry Fetch",
      "Fetch Older Saves",
      "Fetch Save Details",
      "Fetch Original Media",
      "Copy Last Fetch Error",
    ]);
  });

  it("uses collection labels and hides account-only actions for watches", () => {
    expect(groups(buildSourceActionMenu(watch()))).toEqual([
      ["Open Twitter List", "Show Saved Items"],
      ["Copy List Link", "Copy List ID", "Copy Connection ID"],
      ["Fetch New Saves"],
      ["Stop Watching"],
    ]);
  });

  it("hides profile actions without a usable handle", () => {
    const target = account();
    target.handle = null;
    expect(groups(buildSourceActionMenu(target))).toEqual([
      ["Show Saved Items"],
      ["Copy Connection ID"],
      [
        "Fetch New Saves",
        "Fetch Older Saves",
        "Fetch Save Details",
        "Fetch Original Media",
      ],
      ["Sign In Again", "Disconnect Instagram"],
    ]);
  });

  it("disables fetch actions while an account is disconnected", () => {
    const items = buildSourceActionMenu(
      account({ ...ready, tone: "idle", connected: false }),
    );
    for (const label of [
      "Fetch New Saves",
      "Fetch Older Saves",
      "Fetch Save Details",
      "Fetch Original Media",
    ]) {
      const item = findItem(items, label);
      expect(item && "disabled" in item ? item.disabled : undefined).toBe(true);
    }
  });

  it("keeps multi-source menus limited to safe batch actions", () => {
    expect(groups(buildSourceActionMenu([account(), watch()]))).toEqual([
      ["Show Saved Items"],
      ["Fetch New Saves"],
    ]);
  });

  it("toggles likes for an X account and hides the action elsewhere", () => {
    const row: AccountRow = {
      id: "acc-twitter",
      source: "twitter",
      handle: "raphael",
      label: null,
      avatarUrl: null,
      addedAt: "",
      sync: {
        lastSyncedAt: null,
        lastError: null,
        knownCount: 12,
        syncLikes: false,
      },
      connected: true,
      syncing: false,
    };
    const items = buildSourceActionMenu(accountMenuTarget(row, ready));
    const likes = findItem(items, "Sync Likes");
    expect(likes).toMatchObject({ type: "checkbox", checked: false });
    expect(findItem(buildSourceActionMenu(account()), "Sync Likes")).toBeNull();
    if (likes?.type !== "checkbox") throw new Error("Missing Sync Likes");
    likes.onCheckedChange?.(true);
    expect(window.pond.query).toHaveBeenCalledWith("accounts.setSyncLikes", {
      accountId: "acc-twitter",
      syncLikes: true,
    });
  });

  it("does not refresh after a rejected likes preference write", async () => {
    const onChanged = vi.fn();
    vi.mocked(window.pond.query).mockResolvedValueOnce({
      ok: false,
      error: "write failed",
    });
    const row: AccountRow = {
      id: "acc-twitter",
      source: "twitter",
      handle: "raphael",
      label: null,
      avatarUrl: null,
      addedAt: "",
      sync: { lastSyncedAt: null, lastError: null, knownCount: 12 },
      connected: true,
      syncing: false,
    };
    const items = buildSourceActionMenu(accountMenuTarget(row, ready), {
      onChanged,
    });
    const likes = findItem(items, "Sync Likes");
    if (likes?.type !== "checkbox") throw new Error("Missing Sync Likes");
    const notification = nextNotification();

    likes.onCheckedChange?.(false);

    await expect(notification).resolves.toEqual({
      title: "Couldn't update Likes syncing",
      description: "write failed",
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a rejected likes preference request without refreshing", async () => {
    const onChanged = vi.fn();
    vi.mocked(window.pond.query).mockRejectedValueOnce(new Error("offline"));
    const row: AccountRow = {
      id: "acc-twitter",
      source: "twitter",
      handle: "raphael",
      label: null,
      avatarUrl: null,
      addedAt: "",
      sync: { lastSyncedAt: null, lastError: null, knownCount: 12 },
      connected: true,
      syncing: false,
    };
    const likes = findItem(
      buildSourceActionMenu(accountMenuTarget(row, ready), { onChanged }),
      "Sync Likes",
    );
    if (likes?.type !== "checkbox") throw new Error("Missing Sync Likes");
    const notification = nextNotification();

    likes.onCheckedChange?.(false);

    await expect(notification).resolves.toEqual({
      title: "Couldn't update Likes syncing",
      description: "offline",
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("starts the source sign-in flow from the connection group", async () => {
    const items = buildSourceActionMenu(account(), { accounts: [] });
    const signIn = findItem(items, "Sign In Again");
    if (!signIn || !("onClick" in signIn))
      throw new Error("Missing Sign In Again");
    signIn.onClick?.();
    expect(sourceFlow.current()).toBe("connect-wait");
    await vi.waitFor(() => {
      expect(window.pond.connectSource).toHaveBeenCalledWith("instagram");
    });
  });
});
