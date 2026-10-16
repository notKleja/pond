import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "./config";

describe("CLI config", () => {
  it("keeps the config under the per-user application data folder on Windows", () => {
    const appData = "C:\\Users\\Ada\\AppData\\Roaming";
    const path = configPath({ APPDATA: appData }, "win32");
    expect(path.startsWith(appData)).toBe(true);
    expect(path).toMatch(/Pond.cli\.json$/);
    expect(configPath({ POND_CONFIG: "custom.json" }, "win32")).toBe(
      "custom.json",
    );
  });

  it("writes scoped credentials and applies owner-only POSIX permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pond-cli-"));
    const path = join(directory, "config.json");
    try {
      await writeConfig({ token: "secret" }, path);
      await expect(readConfig(path)).resolves.toEqual({ token: "secret" });
      // Windows reports synthetic POSIX mode bits; access is governed by the
      // inherited ACL of the user's private configuration directory.
      if (process.platform !== "win32")
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
