import { describe, expect, it } from "vitest";
import { renameWithRetry } from "./yt-dlp-updater";

function busy(code: string) {
  return Object.assign(new Error(code), { code });
}

function flakyRename(failures: number, code: string) {
  const calls: string[] = [];
  return {
    calls,
    async rename(from: string, to: string) {
      calls.push(`${from}>${to}`);
      if (calls.length <= failures) throw busy(code);
    },
  };
}

const sleep = async () => {};

describe("renameWithRetry", () => {
  it("retries transient Windows lock errors until the rename succeeds", async () => {
    const fs = flakyRename(2, "EBUSY");
    await renameWithRetry("a", "b", {
      rename: fs.rename,
      platform: "win32",
      sleep,
    });
    expect(fs.calls).toHaveLength(3);
  });

  it("gives up after five attempts", async () => {
    const fs = flakyRename(10, "EPERM");
    await expect(
      renameWithRetry("a", "b", {
        rename: fs.rename,
        platform: "win32",
        sleep,
      }),
    ).rejects.toThrow("EPERM");
    expect(fs.calls).toHaveLength(5);
  });

  it("does not retry other errors or other platforms", async () => {
    const missing = flakyRename(10, "ENOENT");
    await expect(
      renameWithRetry("a", "b", {
        rename: missing.rename,
        platform: "win32",
        sleep,
      }),
    ).rejects.toThrow("ENOENT");
    expect(missing.calls).toHaveLength(1);

    const posix = flakyRename(10, "EBUSY");
    await expect(
      renameWithRetry("a", "b", {
        rename: posix.rename,
        platform: "linux",
        sleep,
      }),
    ).rejects.toThrow("EBUSY");
    expect(posix.calls).toHaveLength(1);
  });
});
