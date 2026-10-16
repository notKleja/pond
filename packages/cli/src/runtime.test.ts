import { describe, expect, it } from "vitest";
import { pondLaunchCommand } from "./runtime";

describe("pondLaunchCommand", () => {
  it("starts the per-user Windows install directly", () => {
    const command = pondLaunchCommand("win32", {
      LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
    });
    expect(command.file).toMatch(/Programs[\\/]Pond[\\/]Pond\.exe$/);
    expect(command.args).toEqual([]);
  });

  it("falls back to the pond:// handler without LOCALAPPDATA", () => {
    expect(pondLaunchCommand("win32", {})).toEqual({
      file: "explorer.exe",
      args: ["pond://library"],
    });
  });

  it("keeps the macOS and Linux launchers", () => {
    expect(pondLaunchCommand("darwin").file).toBe("open");
    expect(pondLaunchCommand("linux").file).toBe("gtk-launch");
  });
});
