import type { Source } from "@pond/schema/db";
import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { playUiSuccess } from "@/shared/lib/sounds";

export interface ConnectedAccount {
  id: string;
  handle: string | null;
  label: string | null;
  avatarUrl?: string | null;
}

interface ConnectFlowState {
  source: Source | null;
  waiting: Source | null;
  connectedBefore: ReadonlySet<string>;
  completed: boolean;
  failed: boolean;
  account: ConnectedAccount | null;
}

const store = new Store<ConnectFlowState>({
  source: null,
  waiting: null,
  connectedBefore: new Set<string>(),
  completed: false,
  failed: false,
  account: null,
});

export const connectFlow = {
  start(source: Source, connectedIds: Iterable<string>): void {
    store.setState(() => ({
      source,
      waiting: source,
      connectedBefore: new Set(connectedIds),
      completed: false,
      failed: false,
      account: null,
    }));
    void requestConnection(source);
  },
  retry(): void {
    const source = store.state.source;
    if (!source) return;
    store.setState((s) => ({ ...s, failed: false }));
    void requestConnection(source);
  },
  complete(account: ConnectedAccount): void {
    const already = store.state.completed;
    store.setState((s) =>
      s.completed ? s : { ...s, completed: true, account },
    );
    if (!already) playUiSuccess();
  },
  fail(source: Source): void {
    markFailed(source);
  },
  clear(): void {
    const waiting = store.state.waiting;
    store.setState((s) => (s.waiting === null ? s : { ...s, waiting: null }));
    if (waiting) void window.pond.clearPendingSession(waiting);
  },
};

export function useConnectSource(): Source | null {
  return useSelector(store, (s) => s.source);
}

export function useConnectWaiting(): Source | null {
  return useSelector(store, (s) => s.waiting);
}

export function useConnectedBefore(): ReadonlySet<string> {
  return useSelector(store, (s) => s.connectedBefore);
}

export function useConnectCompleted(): boolean {
  return useSelector(store, (s) => s.completed);
}

export function useConnectedAccount(): ConnectedAccount | null {
  return useSelector(store, (s) => s.account);
}

async function requestConnection(source: Source): Promise<void> {
  try {
    const result = await window.pond.connectSource(source);
    if (!result.ok) markFailed(source);
  } catch {
    markFailed(source);
  }
}

function markFailed(source: Source): void {
  store.setState((s) =>
    s.waiting === source && !s.completed ? { ...s, failed: true } : s,
  );
}

export function useConnectFailed(): boolean {
  return useSelector(store, (s) => s.failed);
}
