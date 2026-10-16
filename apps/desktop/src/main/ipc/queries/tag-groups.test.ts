import { describe, expect, it, vi } from "vitest";
import { createMergeGroupQuery, tagGroupsQueries } from "./tag-groups";

describe("tag group queries", () => {
  it("registers and delegates a valid merge request", async () => {
    const merge = vi.fn(async () => ({ ok: true as const, affected: 2 }));
    const handler = createMergeGroupQuery(merge);

    await expect(
      handler({ from: " Source ", to: " Target " }),
    ).resolves.toEqual({ ok: true, affected: 2 });
    expect(merge).toHaveBeenCalledExactlyOnceWith("Source", "Target");
    expect(tagGroupsQueries).toHaveProperty("tagGroups.merge");
  });

  it("rejects malformed input before calling the operation", () => {
    const merge = vi.fn(async () => ({ ok: true as const, affected: 0 }));
    const handler = createMergeGroupQuery(merge);

    expect(() => handler({ from: "", to: "Target" })).toThrow();
    expect(() => handler({ from: 42, to: "Target" })).toThrow();
    expect(merge).not.toHaveBeenCalled();
  });

  it("propagates operation failures", async () => {
    const failure = new Error("commit failed");
    const handler = createMergeGroupQuery(async () => {
      throw failure;
    });

    await expect(handler({ from: "Source", to: "Target" })).rejects.toBe(
      failure,
    );
  });
});
