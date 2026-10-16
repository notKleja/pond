import type { ConnectedAccount } from "@pond/schema/db";
import { describe, expect, it, vi } from "vitest";
import { createSetSyncLikesQuery } from "./accounts";

function account(source: ConnectedAccount["source"]): ConnectedAccount {
  return {
    id: `${source}:123`,
    source,
    handle: "raphael",
    identityKey: "123",
    label: null,
    addedAt: "2026-10-15T00:00:00.000Z",
    sync: {
      lastSyncedAt: null,
      lastError: null,
      highWaterMark: null,
      lastFullSyncAt: null,
      knownCount: 0,
      runningSince: null,
    },
  };
}

describe("accounts.setSyncLikes", () => {
  it("persists the preference for an X account", async () => {
    const patchAccountSync = vi.fn(async () => account("twitter").sync);
    const operation = createSetSyncLikesQuery({
      getAccount: vi.fn(async () => account("twitter")),
      patchAccountSync,
    });

    await expect(
      operation({ accountId: "twitter:123", syncLikes: false }),
    ).resolves.toEqual({ ok: true });
    expect(patchAccountSync).toHaveBeenCalledWith("twitter:123", {
      syncLikes: false,
    });
  });

  it("rejects unsupported account sources without writing", async () => {
    const patchAccountSync = vi.fn(async () => account("instagram").sync);
    const operation = createSetSyncLikesQuery({
      getAccount: vi.fn(async () => account("instagram")),
      patchAccountSync,
    });

    await expect(
      operation({ accountId: "instagram:123", syncLikes: false }),
    ).resolves.toEqual({
      ok: false,
      error: "Syncing Likes is only available for X accounts.",
    });
    expect(patchAccountSync).not.toHaveBeenCalled();
  });

  it("rejects malformed input at the query boundary", () => {
    const operation = createSetSyncLikesQuery({
      getAccount: vi.fn(),
      patchAccountSync: vi.fn(),
    });

    expect(() => operation({ accountId: "", syncLikes: false })).toThrow();
    expect(() =>
      operation.inputSchema.parse({
        accountId: "twitter:123",
        syncLikes: "false",
      }),
    ).toThrow();
  });

  it("propagates persistence failures", async () => {
    const failure = new Error("write failed");
    const operation = createSetSyncLikesQuery({
      getAccount: vi.fn(async () => account("twitter")),
      patchAccountSync: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(
      operation({ accountId: "twitter:123", syncLikes: true }),
    ).rejects.toBe(failure);
  });
});
