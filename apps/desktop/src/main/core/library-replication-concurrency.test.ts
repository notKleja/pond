import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@pond/schema/json";
import { afterEach, expect, it } from "vitest";
import { createReplicationRunCoordinator } from "./library-replication";
import {
  type AppliedReplicationEvent,
  type LibraryReplicationAdapter,
  type LocalReplicationChange,
  type ReplicationCycleResult,
  runLibraryReplicationCycle,
} from "./library-replication-protocol";
import { createMutationQueue } from "./mutation-queue";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class InterleavingReplica implements LibraryReplicationAdapter {
  readonly entities = new Map<string, JsonObject>();
  readonly changes: LocalReplicationChange[] = [];
  #cursor = 0;

  constructor(
    private readonly beforeApply?: () => Promise<void>,
    private readonly applyOrder?: string[],
  ) {}

  change(modelId: string, snapshot: JsonObject): void {
    this.entities.set(modelId, snapshot);
    this.changes.push({
      cursor: ++this.#cursor,
      model: "save",
      modelId,
      tombstone: false,
      snapshot,
      attachments: [],
    });
  }

  async changesAfter(cursor: number) {
    return this.changes.filter((change) => change.cursor > cursor);
  }

  async apply({ event }: AppliedReplicationEvent): Promise<void> {
    await this.beforeApply?.();
    this.applyOrder?.push("remote-apply");
    if (event.snapshot) this.entities.set(event.modelId, event.snapshot);
  }
}

it("publishes a local edit queued behind incoming apply without losing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pond-replication-race-"));
  roots.push(root);
  const exchange = join(root, "exchange");
  const input = (deviceId: string, adapter: LibraryReplicationAdapter) => ({
    libraryId: "portable-library-id",
    deviceId,
    exchangeDirectory: exchange,
    stateFile: join(root, deviceId, "state.json"),
    adapter,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });

  const remote = new InterleavingReplica();
  remote.change("shared", { title: "remote" });
  await runLibraryReplicationCycle(input("remote-device", remote));

  const applyStarted = Promise.withResolvers<void>();
  const releaseApply = Promise.withResolvers<void>();
  const order: string[] = [];
  const local = new InterleavingReplica(async () => {
    applyStarted.resolve();
    await releaseApply.promise;
  }, order);
  const queue = createMutationQueue();
  const runs = createReplicationRunCoordinator((operation) =>
    queue.run(operation),
  );

  const incoming = runs.run(() =>
    runLibraryReplicationCycle(input("local-device", local)).then(() => {}),
  );
  await applyStarted.promise;
  const localEdit = queue.run(async () => {
    order.push("local-edit");
    local.change("shared", { title: "local" });
  });
  releaseApply.resolve();
  await Promise.all([incoming, localEdit]);
  expect(order).toEqual(["remote-apply", "local-edit"]);
  expect(local.entities.get("shared")).toEqual({ title: "local" });

  let nextResult: ReplicationCycleResult | undefined;
  await runs.run(async () => {
    nextResult = await runLibraryReplicationCycle(input("local-device", local));
  });
  expect(nextResult).toMatchObject({ published: 1 });

  await runLibraryReplicationCycle(input("remote-device", remote));
  expect(remote.entities.get("shared")).toEqual({ title: "local" });
});
