import { describe, expect, it } from "vitest";
import {
  nativeSocketPath,
  parseWindowsUserSid,
  windowsNativePipePath,
} from "./paths";

describe("nativeSocketPath", () => {
  it("uses the host contract's named pipe on Windows", () => {
    expect(nativeSocketPath("win32", () => "S-1-5-21-10-20-30-1001")).toBe(
      String.raw`\\.\pipe\pond-native-host-S-1-5-21-10-20-30-1001`,
    );
  });

  it("parses the SID from whoami CSV output", () => {
    expect(
      parseWindowsUserSid('"DESKTOP\\Person","S-1-5-21-10-20-30-1001"\r\n'),
    ).toBe("S-1-5-21-10-20-30-1001");
    expect(() => parseWindowsUserSid('"DESKTOP\\Person","not-a-sid"')).toThrow(
      "current Windows user SID",
    );
  });

  it("isolates native pipes by Windows user SID", () => {
    expect(windowsNativePipePath("S-1-5-21-1-1001")).not.toBe(
      windowsNativePipePath("S-1-5-21-1-1002"),
    );
    expect(() => windowsNativePipePath("person")).toThrow(
      "Invalid Windows user SID",
    );
  });

  it("keeps the macOS Application Support socket", () => {
    expect(nativeSocketPath("darwin")).toMatch(
      /Library[\\/]Application Support[\\/]Pond[\\/]native\.sock$/,
    );
  });
});
