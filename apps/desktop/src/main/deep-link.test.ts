import { describe, expect, it } from "vitest";
import { deepLinkArg, shouldOpenInitialWindow } from "./deep-link";

describe("deepLinkArg", () => {
  it("finds a Windows protocol launch argument", () => {
    expect(
      deepLinkArg([
        "C:\\Program Files\\Pond\\Pond.exe",
        "pond://settings/general",
      ]),
    ).toBe("pond://settings/general");
  });

  it("ignores unrelated command-line arguments", () => {
    expect(deepLinkArg(["Pond.exe", "--mcp"])).toBeNull();
  });

  it("opens a cold protocol launch even when startup is configured hidden", () => {
    expect(shouldOpenInitialWindow(true, "library")).toBe(true);
    expect(shouldOpenInitialWindow(true, undefined)).toBe(false);
    expect(shouldOpenInitialWindow(false, undefined)).toBe(true);
  });
});
