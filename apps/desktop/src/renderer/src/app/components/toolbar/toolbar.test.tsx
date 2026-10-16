import { PrefsSchema } from "@pond/schema";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { folders } from "@/features/library/state/folders";
import { libraryChrome } from "@/features/library/state/library-chrome";
import { navigationHistory } from "@/features/library/state/navigation-history";
import {
  applySavedView,
  getViewState,
  resetFilters,
  setSearchInput,
} from "@/features/library/state/view-store";
import { rememberListPath } from "@/features/saves/lib/list-path";
import { normalise } from "@/features/saves/lib/reconcile";
import { pool } from "@/features/saves/state/pool";
import { libraryViewContext } from "@/features/saves/state/view-context";
import { setAppRouter } from "@/shared/lib/app-router";
import { Toolbar } from "./";

describe("breadcrumb toolbar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("pond", {
      query: async (name: string) => {
        if (name === "settings.getPrefs") return PrefsSchema.parse({});
        if (name === "folders.list")
          return [
            { id: "parent", name: "Design", parentId: null },
            { id: "child", name: "Interfaces", parentId: "parent" },
            { id: "deep", name: "Mobile", parentId: "child" },
          ].map((folder) => ({
            ...folder,
            color: null,
            sortOrder: 0,
            createdAt: new Date(),
          }));
        return [];
      },
    });
    resetFilters();
    await folders.refresh();
    pool.clear();
    const save = normalise({
      id: "demo",
      title: "A saved design",
      url: "https://example.com",
      source: "local",
    });
    if (!save) throw new Error("Invalid save fixture");
    pool.upsert(save);
    libraryViewContext.set([], "library");
    navigationHistory.clear();
    libraryChrome.setNav({ kind: "all" });
    libraryChrome.setInspectorSaveId(null);
    libraryChrome.setAgentOpen(false);
    libraryChrome.closeRightPane();
    rememberListPath("/");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function button(name: string): HTMLButtonElement {
    const match = [...document.querySelectorAll("button")].find(
      (node) =>
        (node.getAttribute("aria-label") ?? node.textContent)?.trim() === name,
    );
    if (!match) throw new Error(`Missing button: ${name}`);
    return match;
  }

  async function mount(path = "/") {
    const rootRoute = createRootRoute({ component: Toolbar });
    const children = [
      "/",
      "/save/$saveId",
      "/sources",
      "/assistant",
      "/tags",
      "/untagged",
      "/recents",
      "/downloads",
      "/trash",
      "/settings",
    ].map((path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => null,
      }),
    );
    const router = createRouter({
      routeTree: rootRoute.addChildren(children),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    setAppRouter(router);
    await act(async () => {
      await router.load();
      root.render(<RouterProvider router={router} />);
    });
    return router;
  }

  it.each([
    ["/assistant", "Assistant"],
    ["/sources", "Sources"],
    ["/tags", "Tags"],
    ["/untagged", "Untagged"],
    ["/recents", "Recently Used"],
    ["/downloads", "Downloads"],
    ["/trash", "Trash"],
    ["/settings", "Settings"],
  ] as const)("shows %s as a root location", async (path, label) => {
    await mount(path);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      label,
    );
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      host.querySelector('nav[aria-label="Breadcrumb"]')?.textContent,
    ).not.toContain("All");
  });

  it("shows one current location without any tab controls", async () => {
    await mount();
    expect(host.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "All",
    );
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[aria-label="New Tab"]')).toBeNull();
    expect(host.querySelector('[aria-label="History"]')).toBeNull();
  });

  it("shows and updates the search result count, including zero", async () => {
    setSearchInput([], "design", "design");
    await mount();
    expect(
      host.querySelector('nav[aria-label="Breadcrumb"]')?.textContent,
    ).toBe("All/Search results (0)");
    await act(() => libraryViewContext.set(["one", "two"], "library"));
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Search results (2)",
    );
    await act(async () => button("All").click());
    expect(getViewState().q).toBe("");
    expect(libraryChrome.getState().nav).toEqual({ kind: "all" });
  });

  it("navigates to parent folders and clears filters only at All", async () => {
    applySavedView({ id: "view", query: { combinator: "and", rules: [] } });
    libraryChrome.setNav({ kind: "folder", id: "child" });
    const router = await mount();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Interfaces",
    );
    await act(async () => button("Design").click());
    expect(libraryChrome.getState().nav).toEqual({
      kind: "folder",
      id: "parent",
    });
    expect(router.state.location.pathname).toBe("/");
    expect(getViewState().activeViewId).toBe("view");
    await act(async () => button("All").click());
    expect(libraryChrome.getState().nav).toEqual({ kind: "all" });
    expect(getViewState().q).toBe("");
    expect(getViewState().activeViewId).toBeNull();
  });

  it("uses the save title and returns to its containing list", async () => {
    const router = await mount("/save/demo");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "A saved design",
    );
    await act(async () => button("All").click());
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps hidden ancestors accessible through the overflow menu", async () => {
    libraryChrome.setNav({ kind: "folder", id: "deep" });
    await mount();
    await act(async () => button("Show Parent Folders").click());
    const parent = [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent === "Design",
    );
    if (!(parent instanceof HTMLElement))
      throw new Error("Missing parent folder");
    await act(async () => parent.click());
    expect(libraryChrome.getState().nav).toEqual({
      kind: "folder",
      id: "parent",
    });
  });

  it("opens folder operations from a breadcrumb context-menu event", async () => {
    libraryChrome.setNav({ kind: "folder", id: "child" });
    await mount();
    const crumb = host.querySelector('[aria-current="page"]');
    if (!(crumb instanceof HTMLElement))
      throw new Error("Missing current folder breadcrumb");
    await act(async () => {
      crumb.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 24,
          clientY: 24,
        }),
      );
    });
    for (const label of [
      "Open Folder",
      "Quick Access",
      "Icon",
      "Color",
      "Sort By",
      "Customize Folder",
    ]) {
      expect(
        [...document.querySelectorAll('[role^="menuitem"]')].some(
          (item) => item.textContent?.trim() === label,
        ),
      ).toBe(true);
    }
  });

  it("opens pane controls from the sidebar toggle context menu", async () => {
    await mount();
    await act(async () => {
      button("Toggle Sidebar").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 24,
          clientY: 24,
        }),
      );
    });
    expect(
      [...document.querySelectorAll('[role="menuitemcheckbox"]')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Sidebar", "Assistant", "Details"]);
  });

  it("updates back and forward controls using the single router history", async () => {
    const router = await mount();
    expect(button("Back").disabled).toBe(true);
    await act(async () => router.history.push("/sources"));
    expect(button("Back").disabled).toBe(false);
    expect(button("Forward").disabled).toBe(true);
    await act(async () => button("Back").click());
    expect(router.state.location.pathname).toBe("/");
    expect(button("Forward").disabled).toBe(false);
    await act(async () => button("Forward").click());
    expect(router.state.location.pathname).toBe("/sources");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Sources",
    );
  });

  it("leaves an open save before walking folder history", async () => {
    libraryChrome.setNav({ kind: "folder", id: "parent" });
    libraryChrome.setNav({ kind: "folder", id: "child" });
    const previousFolder = navigationHistory.back();
    expect(previousFolder).toEqual({ kind: "folder", id: "parent" });
    if (previousFolder) libraryChrome.setNav(previousFolder);
    const router = await mount("/");
    await act(async () => router.history.push("/save/demo"));
    await act(async () => button("Back").click());
    expect(router.state.location.pathname).toBe("/");
    expect(libraryChrome.getState().nav).toEqual({
      kind: "folder",
      id: "parent",
    });
    await act(async () => button("Forward").click());
    expect(router.state.location.pathname).toBe("/save/demo");
    await act(async () => button("Back").click());
    await act(async () => button("Back").click());
    expect(libraryChrome.getState().nav).toEqual({ kind: "all" });
    await act(async () => button("Forward").click());
    expect(router.state.location.pathname).toBe("/");
    expect(libraryChrome.getState().nav).toEqual({
      kind: "folder",
      id: "parent",
    });
    await act(async () => button("Forward").click());
    expect(router.state.location.pathname).toBe("/save/demo");
    expect(libraryChrome.getState().nav).toEqual({
      kind: "folder",
      id: "parent",
    });
  });

  it("does not offer folder history while a direct save route is open", async () => {
    libraryChrome.setNav({ kind: "folder", id: "parent" });
    await mount("/save/demo");
    expect(button("Back").disabled).toBe(true);
    expect(button("Forward").disabled).toBe(true);
  });

  it("discards the save-forward branch after fresh folder navigation", async () => {
    libraryChrome.setNav({ kind: "folder", id: "parent" });
    const router = await mount("/");
    await act(async () => router.history.push("/save/demo"));
    await act(async () => button("Back").click());
    await act(async () => button("Back").click());
    await act(() => libraryChrome.setNav({ kind: "folder", id: "child" }));
    expect(button("Forward").disabled).toBe(true);
    expect(router.state.location.pathname).toBe("/");
  });

  it("opens Assistant from its own control", async () => {
    await mount();
    expect(button("Toggle Details").getAttribute("aria-pressed")).not.toBe(
      "true",
    );
    await act(async () => button("Assistant").click());
    expect(libraryChrome.getState().rightPane).toBe("agent");
    expect(button("Assistant").getAttribute("aria-pressed")).toBe("true");
    expect(button("Toggle Details").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Toggle Details").click());
    expect(libraryChrome.getState().rightPane).toBeNull();
  });

  it("closes Details without opening Assistant", async () => {
    libraryChrome.openSaveDetails("demo");
    await mount("/save/demo");
    expect(libraryChrome.getState().rightPane).toBe("inspector");
    await act(async () => button("Toggle Details").click());
    expect(libraryChrome.getState().rightPane).toBeNull();
    expect(libraryChrome.getState().inspectorSaveId).toBe("demo");
    expect(button("Assistant").getAttribute("aria-pressed")).not.toBe("true");
  });

  it("keeps the right sidebar toggle visible and reopens Details", async () => {
    libraryChrome.inspectSave("demo");
    libraryChrome.closeRightPane();
    await mount("/save/demo");
    expect(libraryChrome.getState().rightPane).toBeNull();
    expect(button("Toggle Details").getAttribute("aria-pressed")).not.toBe(
      "true",
    );
    await act(async () => button("Toggle Details").click());
    expect(libraryChrome.getState().rightPane).toBe("inspector");
    expect(button("Toggle Details").getAttribute("aria-pressed")).toBe("true");
  });
});
