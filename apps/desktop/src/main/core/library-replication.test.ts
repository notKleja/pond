import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  folders,
  saves,
  syncActions,
  tagGroupMembers,
  tagGroups,
  tags,
} from "@pond/schema/db";
import type { Transaction } from "@pond/schema/tx";
import { and, eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openSqlite, wrapSqlite } from "../database/client";
import { initializePondSchema } from "../database/pond-schema";
import {
  createReplicationRunCoordinator,
  PondReplicationAdapter,
  type PondReplicationRuntime,
} from "./library-replication";
import { runLibraryReplicationCycle } from "./library-replication-protocol";
import { createMutationQueue } from "./mutation-queue";

const roots: string[] = [];
const databases: ReturnType<typeof openSqlite>[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function replica(root: string, name: string) {
  const library = join(root, `${name}.pond`);
  await mkdir(join(library, "items"), { recursive: true });
  const sqlite = openSqlite(join(root, `${name}.db`));
  databases.push(sqlite);
  initializePondSchema(sqlite);
  const db = wrapSqlite(sqlite);
  const runtime: PondReplicationRuntime = {
    async db() {
      return db;
    },
    saveDirectory(id) {
      return join(library, "items", `${id}.info`);
    },
    async execute(transactions) {
      for (const transaction of transactions)
        await apply(db, library, transaction);
    },
  };
  return { db, adapter: new PondReplicationAdapter(runtime) };
}

async function apply(
  db: ReturnType<typeof wrapSqlite>,
  library: string,
  transaction: Transaction,
): Promise<void> {
  if (transaction.model === "save") {
    const directory = join(library, "items", `${transaction.id}.info`);
    if (transaction.kind === "delete" || transaction.kind === "purge") {
      db.delete(saves).where(eq(saves.id, transaction.id)).run();
      await rm(directory, { recursive: true, force: true });
      return;
    }
    if (transaction.kind === "trash" || transaction.kind === "untrash") return;
    await mkdir(directory, { recursive: true });
    for (const file of transaction.files ?? [])
      await writeFile(join(directory, file.filename), file.bytes);
    if (transaction.kind === "create")
      db.insert(saves).values(transaction.data).run();
    else
      db.update(saves)
        .set(transaction.patch)
        .where(eq(saves.id, transaction.id))
        .run();
    return;
  }
  if (transaction.model === "folder") {
    if (transaction.kind === "create")
      db.insert(folders).values(transaction.data).run();
    else if (transaction.kind === "update")
      db.update(folders)
        .set(transaction.patch)
        .where(eq(folders.id, transaction.id))
        .run();
    else db.delete(folders).where(eq(folders.id, transaction.id)).run();
    return;
  }
  if (transaction.model !== "tag_group_member") return;
  if (transaction.kind === "create")
    db.insert(tagGroupMembers).values(transaction.data).run();
  else
    db.delete(tagGroupMembers)
      .where(
        and(
          eq(tagGroupMembers.tagId, transaction.before.tagId),
          eq(tagGroupMembers.groupId, transaction.before.groupId),
        ),
      )
      .run();
}

it("replicates a Save row and original bytes through update, trash, and delete", async () => {
  const root = await mkdtemp(join(tmpdir(), "pond-replication-save-"));
  roots.push(root);
  const exchange = join(root, "exchange");
  await mkdir(exchange);
  const mac = await replica(root, "mac-save");
  const windows = await replica(root, "windows-save");
  const input = (deviceId: string, adapter: PondReplicationAdapter) => ({
    libraryId: "fedcba9876543210",
    deviceId,
    exchangeDirectory: exchange,
    stateFile: join(root, `${deviceId}-save.json`),
    adapter,
  });
  const bytes = Buffer.from("cross-platform original bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const createdAt = new Date("2026-10-15T12:00:00.000Z");
  const row = {
    id: "save",
    source: "local" as const,
    sourceId: "save-source",
    url: "file:///portable/photo.jpg",
    title: "From Mac",
    tags: [],
    listKinds: ["saved" as const],
    files: [{ path: "photo.jpg", kind: "image", size: bytes.length, sha256 }],
    status: "complete" as const,
    container: "jpeg",
    cameraMake: "Portable Camera",
    takenAt: new Date("2025-05-04T10:00:00.000Z"),
    embedding: [0.25, 0.75],
    embeddingModel: "portable-embedding",
    suggestedTags: ["cross-platform"],
    suggestedTagsModel: "portable-tags",
    savedAt: createdAt,
    createdAt,
  };
  mac.db.insert(saves).values(row).run();
  const macOriginal = join(
    root,
    "mac-save.pond",
    "items",
    "save.info",
    "photo.jpg",
  );
  await mkdir(join(macOriginal, ".."), { recursive: true });
  await writeFile(macOriginal, bytes);
  mac.db
    .insert(syncActions)
    .values({
      modelName: "save",
      modelId: "save",
      action: "I",
      data: row,
      actor: "user",
    })
    .run();

  await runLibraryReplicationCycle(input("mac-save-device", mac.adapter));
  await runLibraryReplicationCycle(
    input("windows-save-device", windows.adapter),
  );
  expect(windows.db.select().from(saves).get()).toMatchObject({
    title: "From Mac",
    container: "jpeg",
    cameraMake: "Portable Camera",
    takenAt: new Date("2025-05-04T10:00:00.000Z"),
    embedding: [0.25, 0.75],
    embeddingModel: "portable-embedding",
    suggestedTags: ["cross-platform"],
    suggestedTagsModel: "portable-tags",
  });
  const windowsOriginal = join(
    root,
    "windows-save.pond",
    "items",
    "save.info",
    "photo.jpg",
  );
  expect(await readFile(windowsOriginal)).toEqual(bytes);

  windows.db
    .update(saves)
    .set({ title: "From Windows" })
    .where(eq(saves.id, "save"))
    .run();
  windows.db
    .insert(syncActions)
    .values({
      modelName: "save",
      modelId: "save",
      action: "U",
      data: { title: "From Windows" },
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(
    input("windows-save-device", windows.adapter),
  );
  await runLibraryReplicationCycle(input("mac-save-device", mac.adapter));
  expect(mac.db.select().from(saves).get()?.title).toBe("From Windows");
  expect(await readFile(macOriginal)).toEqual(bytes);

  const deletedAt = new Date("2026-10-15T13:00:00.000Z");
  windows.db.update(saves).set({ deletedAt }).where(eq(saves.id, "save")).run();
  windows.db
    .insert(syncActions)
    .values({
      modelName: "save",
      modelId: "save",
      action: "A",
      data: { deletedAt },
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(
    input("windows-save-device", windows.adapter),
  );
  await runLibraryReplicationCycle(input("mac-save-device", mac.adapter));
  expect(mac.db.select().from(saves).get()?.deletedAt?.toISOString()).toBe(
    deletedAt.toISOString(),
  );

  windows.db.delete(saves).where(eq(saves.id, "save")).run();
  await rm(join(root, "windows-save.pond", "items", "save.info"), {
    recursive: true,
    force: true,
  });
  windows.db
    .insert(syncActions)
    .values({
      modelName: "save",
      modelId: "save",
      action: "D",
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(
    input("windows-save-device", windows.adapter),
  );
  await runLibraryReplicationCycle(input("mac-save-device", mac.adapter));
  expect(mac.db.select().from(saves).get()).toBeUndefined();
  await expect(readFile(macOriginal)).rejects.toMatchObject({ code: "ENOENT" });
});

it("replicates real independent indexes bidirectionally and applies membership tombstones", async () => {
  const root = await mkdtemp(join(tmpdir(), "pond-replication-adapter-"));
  roots.push(root);
  const exchange = join(root, "exchange");
  await mkdir(exchange);
  const mac = await replica(root, "mac-local");
  const windows = await replica(root, "windows-local");
  const input = (deviceId: string, adapter: PondReplicationAdapter) => ({
    libraryId: "0123456789abcdef",
    deviceId,
    exchangeDirectory: exchange,
    stateFile: join(root, `${deviceId}.json`),
    adapter,
  });

  const createdAt = new Date("2026-10-15T12:00:00.000Z");
  mac.db
    .insert(folders)
    .values({
      id: "folder",
      name: "Mac",
      parentId: null,
      color: null,
      sortOrder: 0,
      createdAt,
    })
    .run();
  mac.db
    .insert(syncActions)
    .values({
      modelName: "folder",
      modelId: "folder",
      action: "I",
      data: { id: "folder", name: "Mac" },
      actor: "user",
    })
    .run();

  await runLibraryReplicationCycle(input("mac-device", mac.adapter));
  await runLibraryReplicationCycle(input("windows-device", windows.adapter));
  expect(windows.db.select().from(folders).get()?.name).toBe("Mac");

  windows.db
    .update(folders)
    .set({ name: "Windows" })
    .where(eq(folders.id, "folder"))
    .run();
  windows.db
    .insert(syncActions)
    .values({
      modelName: "folder",
      modelId: "folder",
      action: "U",
      data: { name: "Windows" },
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(input("windows-device", windows.adapter));
  await runLibraryReplicationCycle(input("mac-device", mac.adapter));
  expect(mac.db.select().from(folders).get()?.name).toBe("Windows");

  for (const replica of [mac, windows]) {
    replica.db.insert(tags).values({ id: "tag", name: "Tag", createdAt }).run();
    replica.db
      .insert(tagGroups)
      .values({ id: "group", name: "Group", createdAt })
      .run();
    replica.db
      .insert(tagGroupMembers)
      .values({ tagId: "tag", groupId: "group", sortOrder: 0 })
      .run();
  }
  windows.db
    .delete(tagGroupMembers)
    .where(
      and(
        eq(tagGroupMembers.tagId, "tag"),
        eq(tagGroupMembers.groupId, "group"),
      ),
    )
    .run();
  windows.db
    .insert(syncActions)
    .values({
      modelName: "tag_group_member",
      modelId: "tag:group",
      action: "D",
      prevData: { tagId: "tag", groupId: "group", sortOrder: 0 },
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(input("windows-device", windows.adapter));
  await runLibraryReplicationCycle(input("mac-device", mac.adapter));
  expect(mac.db.select().from(tagGroupMembers).all()).toEqual([]);
});

it("serializes a local edit after incoming apply and publishes it on the next cycle", async () => {
  const queue = createMutationQueue();
  const runs = createReplicationRunCoordinator((operation) =>
    queue.run(operation),
  );
  const gate = Promise.withResolvers<void>();
  const order: string[] = [];
  const cycle = runs.run(async () => {
    await gate.promise;
    order.push("remote-apply");
  });
  const local = queue.run(async () => {
    order.push("local-edit");
  });
  await Promise.resolve();
  expect(order).toEqual([]);
  gate.resolve();
  await Promise.all([cycle, local]);
  expect(order).toEqual(["remote-apply", "local-edit"]);

  await runs.run(async () => {
    order.push("publish-local-edit");
  });
  expect(order.at(-1)).toBe("publish-local-edit");
});

it("drains a paused cycle before allowing a Library switch sentinel", async () => {
  const queue = createMutationQueue();
  const runs = createReplicationRunCoordinator((operation) =>
    queue.run(operation),
  );
  const gate = Promise.withResolvers<void>();
  let switched = false;
  void runs.run(() => gate.promise);
  const switching = runs.drain().then(() => {
    switched = true;
  });
  await Promise.resolve();
  expect(switched).toBe(false);
  gate.resolve();
  await switching;
  expect(switched).toBe(true);
});

it("rejects strict snapshot fields and mismatched entity identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "pond-replication-schema-"));
  roots.push(root);
  const exchange = join(root, "exchange");
  await mkdir(exchange);
  const source = await replica(root, "strict-source");
  const target = await replica(root, "strict-target");
  const input = (deviceId: string, adapter: PondReplicationAdapter) => ({
    libraryId: "strict-library-id",
    deviceId,
    exchangeDirectory: exchange,
    stateFile: join(root, `${deviceId}-strict.json`),
    adapter,
  });
  const createdAt = new Date("2026-10-15T12:00:00.000Z");
  source.db
    .insert(folders)
    .values({ id: "folder", name: "Folder", createdAt })
    .run();
  source.db
    .insert(syncActions)
    .values({
      modelName: "folder",
      modelId: "folder",
      action: "I",
      data: { id: "folder", name: "Folder" },
      actor: "user",
    })
    .run();
  await runLibraryReplicationCycle(input("source-device", source.adapter));
  const manifestPath = join(
    exchange,
    "pond-replication-v1",
    "strict-library-id",
    "events",
    "source-device",
    "0000000000000001-1",
    "event.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.snapshot.id = "different-folder";
  manifest.snapshot.constructor = "prototype-pollution";
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect(
    await runLibraryReplicationCycle(input("target-device", target.adapter)),
  ).toMatchObject({ applied: 0, rejected: 1 });
  expect(target.db.select().from(folders).all()).toEqual([]);
});
