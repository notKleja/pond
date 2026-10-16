import "@/app/effects/save-library-bridge";
import { Tooltip } from "@pond/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadsColumnsLayout } from "@/features/downloads/state/downloads-columns";
import { downloadsFilters } from "@/features/downloads/state/downloads-filters";
import { downloadsSelection } from "@/features/downloads/state/downloads-selection";
import { libraryChrome } from "@/features/library";
import { primarySelection } from "@/features/saves/navigation";
import { savesStore } from "@/features/saves/pool";
import type { Save } from "@/features/saves/types";
import { DownloadsPage } from "./";
import { hydrateLiveDownloadSaves } from "./hydrate-live-saves";

function save(
  id: string,
  status: Save["status"],
  taskStatus?: "running" | "pending" | "dead",
  extras: Partial<Save> = {},
): Save {
  return {
    id,
    source: "youtube",
    sourceId: id,
    url: `https://example.com/${id}`,
    title: id,
    description: null,
    author: null,
    notes: null,
    mediaUrl: null,
    mediaType: null,
    files: [],
    tags: [],
    savedAt: 1,
    createdAt: 1,
    deletedAt: null,
    status,
    tasks: taskStatus
      ? [
          {
            op: "fetch_video_ytdlp",
            status: taskStatus,
            attempts: taskStatus === "pending" ? 0 : 1,
            maxAttempts: 5,
            lastError: taskStatus === "dead" ? "Network unavailable" : null,
            nextRunAt: 0,
            updatedAt: 1,
          },
        ]
      : [],
    ...extras,
  };
}
function setSaves(saves: Save[]) {
  savesStore.setState((state) => ({
    byId: new Map(saves.map((save) => [save.id, save])),
    sorted: saves,
    revision: state.revision + 1,
  }));
}
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const query = vi.fn();
const pipelinePause = vi.fn(async (paused: boolean) => ({ ok: true, paused }));
const pipelineCancelSave = vi.fn(async () => ({ ok: true, cancelled: true }));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.clearAllMocks();
  downloadsFilters.reset();
  downloadsColumnsLayout.reset();
  primarySelection.set(null);
  libraryChrome.inspectSave(null);
  libraryChrome.closeRightPane();
  Object.assign(window, { pond: { query, pipelinePause, pipelineCancelSave } });
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") return [];
    if (name === "saves.getMany") return [];
    throw new Error(`Unexpected query: ${name}`);
  });
  setSaves([
    save("Running video", "ingesting", "running"),
    save("Waiting video", "ingesting", "pending"),
    save("Failed video", "failed", "dead"),
  ]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    downloadsSelection.clear();
    downloadsFilters.reset();
    setSaves([]);
  });
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Tooltip.Provider>
          <DownloadsPage />
        </Tooltip.Provider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(selector: string, modifiers = {}) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, ...modifiers }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function rowNames(): string[] {
  return [...host.querySelectorAll('[role="row"]')].flatMap((row) => {
    const name = row.querySelector("[title]")?.getAttribute("title");
    return row.closest('[role="rowgroup"]') && name ? [name] : [];
  });
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickFilterOption(label: string) {
  const option = [
    ...document.querySelectorAll('[role="menuitemcheckbox"]'),
  ].find((node) => node.textContent === label);
  if (!option) throw new Error(`Missing filter option ${label}`);
  await act(async () =>
    option.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it("shows live downloads that paging missed without hydrating the whole library", async () => {
  const queued = save("Old failure", "failed", "dead");
  setSaves([save("Recent clip", "complete")]);
  query.mockImplementation(async (name: string, args?: { ids?: string[] }) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") return [queued.id];
    if (name === "saves.getMany") {
      expect(args?.ids).toEqual([queued.id]);
      return [queued];
    }
    if (name === "saves.list") {
      throw new Error("must not hydrate the full save pool");
    }
    throw new Error(`Unexpected query: ${name}`);
  });
  await render();
  expect(query).toHaveBeenCalledWith("downloads.ingestingOrFailed", {});
  expect(query).not.toHaveBeenCalledWith("saves.list", expect.anything());
  expect(host.textContent).toContain("Old failure");
  expect(host.querySelector('[title="Recent clip"]')).toBeNull();
});

it("does not refetch queue saves that are already in the library pool", async () => {
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") {
      return ["Running video", "Waiting video", "Failed video"];
    }
    if (name === "saves.getMany") return [];
    throw new Error(`Unexpected query: ${name}`);
  });

  await render();

  expect(query).not.toHaveBeenCalledWith("saves.getMany", expect.anything());
});

it("hydrates large queues in renderer-sized batches", async () => {
  setSaves([]);
  const ids = Array.from({ length: 401 }, (_, index) => `save-${index}`);

  await hydrateLiveDownloadSaves(ids, () => false);

  const batches = query.mock.calls.flatMap(([name, args]) =>
    name === "saves.getMany" ? [args.ids] : [],
  );
  expect(batches.map((batch) => batch.length)).toEqual([200, 200, 1]);
});

it("keeps running work active when the queue is paused without showing action bars", async () => {
  await render();
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector('[aria-label="Filter"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Queue details"]')).toBeNull();
  expect(host.querySelector("footer")).toBeNull();
  await click('[aria-label="Pause Queue"]');
  expect(pipelinePause).toHaveBeenCalledWith(true);
  expect(
    host.querySelector('[data-status="running"]')?.hasAttribute("data-moving"),
  ).toBe(true);
  expect(host.querySelector('[data-status="waiting"]')?.textContent).toContain(
    "Paused",
  );
  await click('[title="Failed video"]', { metaKey: true });
  expect(host.querySelector('[aria-label="Selected downloads"]')).toBeNull();
  expect(host.querySelector('[aria-label="Retry Selected"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Actions for Running video"]'),
  ).toBeNull();
  expect(document.querySelector('[role="menuitem"]')).toBeNull();
  expect(primarySelection.get()).toBeNull();
});

it("preserves row selection and prunes completed selections after live updates", async () => {
  await render();
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  await click('[title="Running video"]', { metaKey: true });
  expect(downloadsSelection.size()).toBe(1);
  expect(primarySelection.get()).toBeNull();
  await act(async () =>
    setSaves([
      save("Running video", "complete"),
      save("Failed video", "failed", "dead"),
    ]),
  );
  expect(downloadsSelection.size()).toBe(0);
  await click('[title="Failed video"]');
  expect(primarySelection.get()).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(libraryChrome.getState().inspectorSaveId).toBeNull();
});

it("selects a download row on click", async () => {
  await render();
  await click('[title="Running video"]');

  const selectedRow = host
    .querySelector('[title="Running video"]')
    ?.closest('[role="row"]');
  expect(selectedRow?.hasAttribute("data-selected")).toBe(true);
  expect(selectedRow?.hasAttribute("data-inspected")).toBe(false);
});

it("selects every download with Command-A while the table is focused", async () => {
  await render();
  const table = host.querySelector<HTMLElement>('[role="grid"]');
  if (!table) throw new Error("Missing Downloads table");
  table.focus();

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(downloadsSelection.size()).toBe(3);
});

it("lists waiting and completed rows in the same table", async () => {
  setSaves([
    save("Z clip", "ingesting", "running"),
    save("A clip", "ingesting", "running"),
    save("Waiting video", "ingesting", "pending"),
  ]);
  await render();
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector('[title="Waiting video"]')).not.toBeNull();
  const waitingProgress = host.querySelector(
    '[aria-label="Waiting video transfer progress"]',
  );
  expect(waitingProgress?.getAttribute("aria-valuenow")).toBe("0");
  expect(waitingProgress?.textContent).toBe("0%");
  expect(waitingProgress?.querySelector("progress")).toBeNull();
  await click('[aria-label="Sort by Name"]');
  expect(rowNames()).toEqual(["A clip", "Waiting video", "Z clip"]);
  await click('[aria-label="Sort by Name"]');
  expect(rowNames()).toEqual(["Z clip", "Waiting video", "A clip"]);
  expect(downloadsSelection.size()).toBe(0);
  expect(primarySelection.get()).toBeNull();
});

it("shows completed history in the table without opening a group", async () => {
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "pipeline.status") return { paused: false };
    if (
      name === "downloads.activity" ||
      name === "downloads.ingestingOrFailed" ||
      name === "pipeline.inflight"
    )
      return [];
    if (name === "downloads.history")
      return {
        rows: [
          {
            id: 2,
            saveId: "local-file",
            title: "Local file",
            url: "pond:local/local-file",
            source: "local",
            outcome: "complete",
            durationMs: 0,
            attempts: 0,
            failedOp: null,
            error: null,
            ts: 2_000,
          },
          {
            id: 1,
            saveId: "done",
            title: "Saved clip",
            url: "https://example.com/done",
            source: "youtube",
            outcome: "complete",
            durationMs: 3000,
            attempts: 1,
            failedOp: null,
            error: null,
            ts: 1000,
          },
        ],
        nextCursor: null,
      };
    throw new Error(`Unexpected query: ${name}`);
  });
  await render();
  expect(host.querySelector('[title="Local file"]')).toBeNull();
  await click('[title="Saved clip"]');
  expect(primarySelection.get()).toBeNull();
  await click('[title="Saved clip"]', { detail: 2 });
  expect(primarySelection.get()).toBe("done");
});

it("keeps status out of the name and shows the normalized source", async () => {
  setSaves([
    save("Clip", "ingesting", "pending"),
    save("Failed video", "failed", "dead", {
      source: "web",
      url: "https://www.youtube.com/",
      title: "https://www.youtube.com/",
    }),
  ]);
  await render();
  expect(host.querySelector('[aria-label="Sort by Status"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Sort by Source"]')).not.toBeNull();
  expect(host.querySelector('[title="Clip"]')?.textContent).not.toContain(
    "In Progress",
  );
  expect(
    host.querySelector('[title="https://www.youtube.com/"]')?.textContent,
  ).not.toContain("Failed");
  expect(host.querySelector('[data-status="waiting"]')?.textContent).toContain(
    "Waiting",
  );
  expect(host.textContent).toContain("Stopped after 1 attempt");
  const youtubeRow = host
    .querySelector('[title="https://www.youtube.com/"]')
    ?.closest('[role="row"]');
  expect(youtubeRow?.textContent).toContain("YouTube");
});

it("keeps media previews out of the name column", async () => {
  setSaves([
    save("Image file", "failed", undefined, { mediaType: "image" }),
    save("Video file", "ingesting", "running", { mediaType: "video" }),
  ]);
  await render();
  const image = host.querySelector('[title="Image file"]');
  const video = host.querySelector('[title="Video file"]');
  expect(image?.querySelector("svg")).toBeNull();
  expect(video?.querySelector("svg")).toBeNull();
  expect(image?.querySelector("img")).toBeNull();
  expect(video?.querySelector("img")).toBeNull();
});

it("filters active, waiting, and failed work from the filter toolbar", async () => {
  await render();
  await clickButton("Filter");
  await clickButton("Status");
  await clickFilterOption("Waiting");
  expect(host.querySelector('[title="Waiting video"]')).not.toBeNull();
  expect(host.querySelector('[title="Running video"]')).toBeNull();
  expect(host.querySelector('[title="Failed video"]')).toBeNull();

  await clickFilterOption("Waiting");
  await clickFilterOption("Active");
  expect(host.querySelector('[title="Running video"]')).not.toBeNull();
  expect(host.querySelector('[title="Waiting video"]')).toBeNull();

  await clickFilterOption("Active");
  await clickFilterOption("Failed");
  expect(host.querySelector('[title="Failed video"]')).not.toBeNull();
  expect(host.querySelector('[title="Running video"]')).toBeNull();
  expect(host.querySelector('[title="Waiting video"]')).toBeNull();
});

it("moves every unfinished download to Trash and leaves finished saves", async () => {
  setSaves([
    save("Running video", "ingesting", "running"),
    save("Waiting video", "ingesting", "pending"),
    save("Failed video", "failed", "dead"),
    save("Finished video", "complete"),
  ]);
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") {
      return [
        "Running video",
        "Waiting video",
        "Failed video",
        "Older hidden failure",
      ];
    }
    if (name === "saves.getMany") return [];
    if (name === "downloads.clearUnfinished") {
      return {
        changed: 4,
        ids: [
          "Running video",
          "Waiting video",
          "Failed video",
          "Older hidden failure",
        ],
      };
    }
    if (name === "feedback.emit") return { ok: true };
    throw new Error(`Unexpected query: ${name}`);
  });

  await render();
  await clickButton("Filter");
  await clickButton("Status");
  await clickFilterOption("Failed");
  await clickButton("Clear Unfinished");

  expect(query).toHaveBeenCalledWith("downloads.clearUnfinished", {});
  expect(query).not.toHaveBeenCalledWith("saves.bulkEdit", expect.anything());
  expect(savesStore.state.byId.get("Finished video")?.deletedAt).toBeNull();
});

it("prevents duplicate clear requests while moving downloads to Trash", async () => {
  let finishTrash: (() => void) | undefined;
  const trashFinished = new Promise<void>((resolve) => {
    finishTrash = resolve;
  });
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") return ["Running video"];
    if (name === "saves.getMany") return [];
    if (name === "downloads.clearUnfinished") {
      await trashFinished;
      return { changed: 1, ids: ["Running video"] };
    }
    if (name === "feedback.emit") return { ok: true };
    throw new Error(`Unexpected query: ${name}`);
  });

  await render();
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === "Clear Unfinished",
  );
  if (!button) throw new Error("Missing Clear Unfinished button");
  await act(async () => button.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => button.click());

  expect(
    query.mock.calls.filter(([name]) => name === "downloads.clearUnfinished"),
  ).toHaveLength(1);
  await act(async () => {
    finishTrash?.();
    await trashFinished;
  });
});

it("ignores hydration rows captured before unfinished downloads were cleared", async () => {
  let finishHydration: ((rows: Save[]) => void) | undefined;
  const hydration = new Promise<Save[]>((resolve) => {
    finishHydration = resolve;
  });
  setSaves([save("Running video", "ingesting", "running")]);
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return [];
    if (name === "downloads.ingestingOrFailed") return ["Older failure"];
    if (name === "saves.getMany") return hydration;
    if (name === "downloads.clearUnfinished") {
      return { changed: 2, ids: ["Running video", "Older failure"] };
    }
    if (name === "feedback.emit") return { ok: true };
    throw new Error(`Unexpected query: ${name}`);
  });

  await render();
  await clickButton("Clear Unfinished");
  await act(async () => {
    finishHydration?.([save("Older failure", "failed", "dead")]);
    await hydration;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(host.querySelector('[title="Running video"]')).toBeNull();
  expect(host.querySelector('[title="Older failure"]')).toBeNull();
});

it("ignores in-flight reloads captured before running downloads were cleared", async () => {
  let finishReload: ((rows: Save[]) => void) | undefined;
  const reload = new Promise<Save[]>((resolve) => {
    finishReload = resolve;
  });
  setSaves([save("Running video", "ingesting", "running")]);
  query.mockImplementation(async (name: string) => {
    if (name === "settings.getPrefs") return {};
    if (name === "downloads.activity") return [];
    if (name === "downloads.history") return { rows: [], nextCursor: null };
    if (name === "pipeline.status") return { paused: false };
    if (name === "pipeline.inflight") return ["Running video"];
    if (name === "downloads.ingestingOrFailed") return [];
    if (name === "saves.getMany") return reload;
    if (name === "downloads.clearUnfinished") {
      return { changed: 1, ids: ["Running video"] };
    }
    if (name === "feedback.emit") return { ok: true };
    throw new Error(`Unexpected query: ${name}`);
  });

  await render();
  await clickButton("Clear Unfinished");
  await act(async () => {
    finishReload?.([save("Running video", "ingesting", "running")]);
    await reload;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(host.querySelector('[title="Running video"]')).toBeNull();
});

it("bounds the initial render before the downloads table is measured", async () => {
  setSaves(
    Array.from({ length: 1_000 }, (_, index) =>
      save(`Failed video ${index}`, "failed", "dead"),
    ),
  );

  await render();

  expect(host.querySelectorAll('[role="row"]').length).toBeLessThan(100);
});
