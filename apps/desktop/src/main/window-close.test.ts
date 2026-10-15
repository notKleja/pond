import { describe, expect, it } from "vitest";
import { shouldHideWindowOnClose } from "./window";

describe("shouldHideWindowOnClose", () => {
  const closeToTray = {
    isQuitting: false,
    closeToTrayEnabled: true,
    hasTray: true,
    isMainWindow: true,
  };

  it("hides the main window when close-to-tray is enabled", () => {
    expect(shouldHideWindowOnClose(closeToTray)).toBe(true);
  });

  it("allows an explicit application quit to close the window", () => {
    expect(shouldHideWindowOnClose({ ...closeToTray, isQuitting: true })).toBe(
      false,
    );
  });

  it("does not intercept close without a tray", () => {
    expect(shouldHideWindowOnClose({ ...closeToTray, hasTray: false })).toBe(
      false,
    );
  });
});
