import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refetchAccounts } from "@/features/sources/hooks/use-accounts";
import { connectFlow } from "@/features/sources/state/connect-flow";
import { ConnectWaitSection } from "./";

let root: Root;
let host: HTMLDivElement;

const twitterAccount = {
  id: "acc-twitter",
  source: "twitter",
  handle: "raph",
  label: null,
  addedAt: "2026-01-01T00:00:00.000Z",
  sync: { lastSyncedAt: null, lastError: null, knownCount: 0 },
  connected: true,
  syncing: false,
};

function stubPond(
  onImported?: (
    cb: (payload: { source: string; accountId: string }) => void,
  ) => void,
  onImportFailed?: (
    cb: (payload: { source: string; reason: string }) => void,
  ) => void,
) {
  vi.stubGlobal("pond", {
    query: async () => ({ accounts: [twitterAccount] }),
    connectSource: async () => ({ ok: true, mode: "external" }),
    syncRunNow: async () => ({ ok: true }),
    clearPendingSession: async () => ({ ok: true }),
    onSessionImported: (
      cb: (payload: { source: string; accountId: string }) => void,
    ) => {
      onImported?.(cb);
      return () => {};
    },
    onSessionImportFailed: (
      cb: (payload: { source: string; reason: string }) => void,
    ) => {
      onImportFailed?.(cb);
      return () => {};
    },
  });
}

beforeEach(() => {
  stubPond();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  connectFlow.clear();
  vi.stubGlobal("pond", {
    query: async () => ({ accounts: [] }),
    connectSource: async () => ({ ok: true, mode: "external" }),
    syncRunNow: async () => ({ ok: true }),
    clearPendingSession: async () => ({ ok: true }),
    onSessionImported: () => () => {},
    onSessionImportFailed: () => () => {},
  });
  await refetchAccounts();
  vi.unstubAllGlobals();
});

it("marks the wait screen connected when a new account arrives", async () => {
  connectFlow.start("twitter", []);
  await act(async () => {
    root.render(<ConnectWaitSection />);
  });
  await vi.waitFor(() => {
    expect(host.textContent).toContain("Pond is syncing your saved posts now.");
  });
});

it("marks the wait screen connected when an existing account is reimported", async () => {
  let imported:
    | ((payload: { source: string; accountId: string }) => void)
    | undefined;
  stubPond((cb) => {
    imported = cb;
  });
  connectFlow.start("twitter", ["acc-twitter"]);
  await act(async () => {
    root.render(<ConnectWaitSection />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.textContent).toContain("Sign in to Twitter in your browser.");
  const sessionImported = imported;
  if (!sessionImported)
    throw new Error("session import listener was not attached");
  await act(async () => {
    sessionImported({ source: "twitter", accountId: "acc-twitter" });
  });
  await vi.waitFor(() => {
    expect(host.textContent).toContain("Pond is syncing your saved posts now.");
  });
});

it("explains the local connection before the account arrives", async () => {
  stubPond();
  connectFlow.start("twitter", ["acc-twitter"]);
  await act(async () => {
    root.render(<ConnectWaitSection />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(host.textContent).toContain("Connect Twitter to Pond");
  expect(host.textContent).toContain("Keep your session on this device");
  expect(host.textContent).toContain("Read your saved posts");
  expect(host.textContent).toContain(
    "Pond gets your session through its browser extension.",
  );
  expect(host.textContent).toContain("Get Extension");
  expect(host.textContent).toContain(
    "You're responsible for following Twitter's terms while Pond syncs your account.",
  );
  expect(host.textContent).not.toContain("Waiting for sign-in");
});

it("shows a retry when the Instagram session import is rejected", async () => {
  let importFailed:
    | ((payload: { source: string; reason: string }) => void)
    | undefined;
  stubPond(undefined, (cb) => {
    importFailed = cb;
  });
  connectFlow.start("instagram", []);
  await act(async () => {
    root.render(<ConnectWaitSection />);
  });

  const notifyImportFailed = importFailed;
  if (!notifyImportFailed)
    throw new Error("session import failure listener was not attached");
  await act(async () => {
    notifyImportFailed({
      source: "instagram",
      reason: "no_auth_cookies_in_payload",
    });
  });

  expect(host.textContent).toContain("Couldn't connect Instagram");
  expect(host.textContent).toContain("Try opening the sign-in page again.");
});
