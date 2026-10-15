import { describe, expect, it } from "vitest";
import {
  manifestBody,
  nativeHostFilename,
  WINDOWS_NATIVE_MESSAGING_REGISTRY_KEYS,
  windowsRegistryArgs,
} from "./manifests";

describe("native host manifests", () => {
  it("uses an executable host on Windows", () => {
    expect(nativeHostFilename("win32")).toBe("pond-native-host.exe");
    expect(nativeHostFilename("darwin")).toBe("pond-native-host");
  });

  it("registers the Chromium browsers supported on Windows", () => {
    expect(WINDOWS_NATIVE_MESSAGING_REGISTRY_KEYS).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Google\\Chrome\\NativeMessagingHosts"),
        expect.stringContaining("Microsoft\\Edge\\NativeMessagingHosts"),
        expect.stringContaining("BraveSoftware\\Brave-Browser"),
      ]),
    );
  });

  it("writes an absolute native messaging executable into the manifest", () => {
    expect(
      JSON.parse(manifestBody("C:\\Program Files\\Pond\\pond-native-host.exe")),
    ).toMatchObject({
      path: "C:\\Program Files\\Pond\\pond-native-host.exe",
      type: "stdio",
    });
  });

  it("passes manifest paths with spaces as one registry argument", () => {
    const manifestPath =
      "C:\\Users\\A Person\\AppData\\Roaming\\Pond\\native-messaging\\com.pond.native.json";
    expect(
      windowsRegistryArgs(
        WINDOWS_NATIVE_MESSAGING_REGISTRY_KEYS[0],
        manifestPath,
      ),
    ).toContain(manifestPath);
  });
});
