import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLibrarySaveGap } from "@/features/library/components/layouts/save-gap";
import { libraryHeader } from "@/features/library/state/library-header";
import { setZoom } from "@/features/library/state/view-store";
import { setDisplayPref } from "@/features/saves";
import { ViewMenu } from "./";

describe("view menu", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    libraryHeader.closePopover();
    setZoom(130);
    setLibrarySaveGap(16);
    setDisplayPref("source", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    libraryHeader.closePopover();
    setZoom(130);
    setLibrarySaveGap(16);
    setDisplayPref("source", true);
    vi.unstubAllGlobals();
  });

  it("opens layout, sort, and display as separate menus", async () => {
    await act(async () => root.render(<ViewMenu />));

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Layout"]')
        ?.click();
    });
    expect(document.body.textContent).toContain("Waterfall");
    expect(document.body.textContent).toContain("Size");
    expect(document.body.textContent).not.toContain("Use Everywhere");
    expect(document.body.textContent).toContain("Gap");
    expect(document.body.textContent).toContain("Thumbnail Quality");
    expect(document.body.textContent).toContain("Thumbnail Fit");
    expect(document.body.textContent).toContain("Item Info");
    expect(document.querySelector('input[aria-label="Size"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Gap"]')).not.toBeNull();
    expect(document.body.textContent).toContain("130 px");
    expect(document.body.textContent).toContain("16 px");
    expect(document.body.textContent).not.toContain("Show Sidebar");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Sort"]')?.click();
    });
    expect(document.body.textContent).toContain("Direction");
    expect(document.body.textContent).toContain("Descending");
    expect(document.body.textContent).toContain("Sort");
    expect(document.body.textContent).toContain("Date Saved");
    expect(document.body.textContent).not.toContain("Refresh");
    expect(document.body.textContent).not.toContain("Use Everywhere");

    expect(document.querySelector('[aria-label="Thumbnail"]')).toBeNull();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Display"]')
        ?.click();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Show Name");
    expect(text).toContain("Show Item Info");
    expect(text).not.toContain("Thumbnail Quality");
    expect(text).not.toContain("Thumbnail Fit");
    expect(text).not.toContain("Date Saved");
    expect(text).toContain("Show Sidebar");
    expect(text).toContain("Show Inspector");
    expect(text).toContain("Show Source Tag");
    expect(text).not.toContain("Show Tags");
    expect(text).not.toContain("Show Annotation");
    expect(text).not.toContain("Show Notes");
    expect(text).not.toContain("Start Presentation");
    expect(text).not.toContain("Use Everywhere");
  });

  it("steps through discrete size and gap values with the keyboard", async () => {
    await act(async () => root.render(<ViewMenu />));
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Layout"]')
        ?.click();
    });

    const size = document.querySelector<HTMLInputElement>(
      'input[aria-label="Size"]',
    );
    const gap = document.querySelector<HTMLInputElement>(
      'input[aria-label="Gap"]',
    );
    expect(size?.getAttribute("aria-valuetext")).toBe("130 pixels");
    expect(gap?.getAttribute("aria-valuetext")).toBe("16 pixels");

    await act(async () => {
      size?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      gap?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(window.localStorage.getItem("pond.gridZoom")).toBe("155");
    expect(window.localStorage.getItem("pond.itemGap")).toBe("24");

    await act(async () => {
      size?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      gap?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });

    expect(window.localStorage.getItem("pond.gridZoom")).toBe("360");
    expect(window.localStorage.getItem("pond.itemGap")).toBe("64");
  });

  it("lets people hide source tags from display options", async () => {
    await act(async () => root.render(<ViewMenu />));

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Display"]')
        ?.click();
    });

    const label = Array.from(document.querySelectorAll("label")).find((node) =>
      node.textContent?.includes("Show Source Tag"),
    );
    const toggle = label?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    await act(async () => toggle?.click());

    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("pond.display.source")).toBe("0");
  });
});
