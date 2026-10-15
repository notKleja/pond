import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@pond/schema/json";
import { afterEach, expect, it } from "vitest";
import {
  type AppliedReplicationEvent,
  compareReplicationVersions,
  type LibraryReplicationAdapter,
  type LocalReplicationChange,
  readReplicationConflicts,
  runLibraryReplicationCycle,
} from "./library-replication-protocol";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class Replica implements LibraryReplicationAdapter {
  readonly entities = new Map<string, JsonObject>();
  readonly changes: LocalReplicationChange[] = [];
  #cursor = 0;

  change(
    modelId: string,
    snapshot: JsonObject,
    attachments: LocalReplicationChange["attachments"] = [],
  ) {
    this.entities.set(modelId, snapshot);
    this.changes.push({
      cursor: ++this.#cursor,
      model: "save",
      modelId,
      tombstone: false,
      snapshot,
      attachments,
    });
  }

  delete(modelId: string) {
    this.entities.delete(modelId);
    this.changes.push({
      cursor: ++this.#cursor,
      model: "save",
      modelId,
      tombstone: true,
      snapshot: null,
      attachments: [],
    });
  }

  async changesAfter(cursor: number) {
    return this.changes.filter((change) => change.cursor > cursor);
  }

  async apply({ event }: AppliedReplicationEvent) {
    if (event.tombstone) this.entities.delete(event.modelId);
    else if (event.snapshot) this.entities.set(event.modelId, event.snapshot);
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pond-replication-"));
  roots.push(root);
  const exchange = join(root, "exchange");
  await mkdir(exchange);
  const a = new Replica();
  const b = new Replica();
  const input = (deviceId: string, adapter: Replica) => ({
    libraryId: "portable-library-id",
    deviceId,
    exchangeDirectory: exchange,
    stateFile: join(root, deviceId, "state.json"),
    adapter,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  return { root, exchange, a, b, input };
}

it("replicates independent Mac and Windows forks in both directions after offline edits", async () => {
  const { root, a, b, input } = await setup();
  const media = join(
    root,
    "Windows Library.pond",
    "items",
    "one.info",
    "photo.jpg",
  );
  await mkdir(join(media, ".."), { recursive: true });
  await writeFile(media, "portable-original");

  a.change("from-windows", { title: "Windows edit" }, [
    { source: media, path: "files/photo.jpg" },
  ]);
  b.change("from-mac", { title: "macOS edit" });

  expect(
    await runLibraryReplicationCycle(input("windows-device", a)),
  ).toMatchObject({
    published: 1,
    applied: 0,
  });
  expect(
    await runLibraryReplicationCycle(input("mac-device", b)),
  ).toMatchObject({
    published: 1,
    applied: 1,
  });
  expect(
    await runLibraryReplicationCycle(input("windows-device", a)),
  ).toMatchObject({
    published: 0,
    applied: 1,
  });
  expect([...a.entities.keys()].sort()).toEqual(["from-mac", "from-windows"]);
  expect([...b.entities.keys()].sort()).toEqual(["from-mac", "from-windows"]);
});

it("is idempotent and records immutable losing and winning event IDs", async () => {
  const { root, a, b, input } = await setup();
  a.change("shared", { title: "A" });
  b.change("shared", { title: "B" });
  await runLibraryReplicationCycle(input("a-device", a));
  const first = await runLibraryReplicationCycle(input("z-device", b));
  expect(first).toMatchObject({ applied: 0, ignored: 1 });
  const converged = await runLibraryReplicationCycle(input("a-device", a));
  expect(converged).toMatchObject({ applied: 1, conflicts: 1 });
  expect(a.entities.get("shared")).toEqual({ title: "B" });
  expect(
    await readReplicationConflicts(join(root, "a-device", "state.json")),
  ).toMatchObject([
    {
      loser: { deviceId: "a-device", eventId: "0000000000000001-1" },
      winner: { deviceId: "z-device", eventId: "0000000000000001-1" },
    },
  ]);
  expect((await runLibraryReplicationCycle(input("a-device", a))).applied).toBe(
    0,
  );
});

it("does not resurrect an entity when a deterministic tombstone beats a stale update", async () => {
  const { a, b, input } = await setup();
  a.change("shared", { title: "stale edit" });
  b.delete("shared");
  await runLibraryReplicationCycle(input("a-device", a));
  await runLibraryReplicationCycle(input("z-device", b));
  await runLibraryReplicationCycle(input("a-device", a));
  expect(a.entities.has("shared")).toBe(false);
  expect(b.entities.has("shared")).toBe(false);
});

it("ignores incomplete staging bundles", async () => {
  const { exchange, b, input } = await setup();
  await mkdir(
    join(
      exchange,
      "pond-replication-v1",
      "portable-library-id",
      "events",
      "a-device",
      ".tmp-uploading",
    ),
    { recursive: true },
  );
  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 0,
    incomplete: 1,
  });
});

it("applies valid peer events while quarantining an invalid extra-file bundle", async () => {
  const { exchange, a, b, input } = await setup();
  a.change("invalid", { title: "invalid" });
  a.change("valid", { title: "valid" });
  await runLibraryReplicationCycle(input("a-device", a));
  await writeFile(
    join(
      exchange,
      "pond-replication-v1",
      "portable-library-id",
      "events",
      "a-device",
      "0000000000000001-1",
      "unexpected.txt",
    ),
    "unexpected",
  );
  const result = await runLibraryReplicationCycle(input("z-device", b));
  expect(result).toMatchObject({ applied: 1, rejected: 1 });
  expect(b.entities.has("invalid")).toBe(false);
  expect(b.entities.get("valid")).toEqual({ title: "valid" });
});

it("rejects checksum damage, traversal paths, and symbolic links", async () => {
  const { root, exchange, a, b, input } = await setup();
  const original = join(root, "original.bin");
  await writeFile(original, "original");
  a.change("one", { title: "one" }, [
    { source: original, path: "files/original.bin" },
  ]);
  await runLibraryReplicationCycle(input("a-device", a));
  const eventRoot = join(
    exchange,
    "pond-replication-v1",
    "portable-library-id",
    "events",
    "a-device",
    "0000000000000001-1",
  );
  await writeFile(join(eventRoot, "files", "original.bin"), "damaged");
  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 0,
    rejected: 1,
  });

  await writeFile(join(eventRoot, "files", "original.bin"), "original");
  const manifestPath = join(eventRoot, "event.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.attachments[0].path = "../outside";
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 0,
    rejected: 1,
  });

  manifest.attachments[0].path = "files/original.bin";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await rm(join(eventRoot, "files", "original.bin"));
  const linkPath = join(eventRoot, "files", "original.bin");
  try {
    await symlink(original, linkPath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EPERM", "EACCES"].includes(String(error.code))
    )
      throw error;
    return;
  }
  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 0,
    rejected: 1,
  });
});

it("rejects Windows-reserved and case-colliding portable attachment names", async () => {
  const { root, a, input } = await setup();
  const first = join(root, "first.bin");
  const second = join(root, "second.bin");
  await writeFile(first, "first");
  await writeFile(second, "second");
  a.change("reserved", { title: "reserved" }, [
    { source: first, path: "files/CON.txt" },
  ]);
  await expect(
    runLibraryReplicationCycle(input("a-device", a)),
  ).rejects.toThrow("unsafe");

  const { a: another, input: anotherInput } = await setup();
  another.change("collision", { title: "collision" }, [
    { source: first, path: "files/Photo.jpg" },
    { source: second, path: "files/photo.JPG" },
  ]);
  await expect(
    runLibraryReplicationCycle(anotherInput("a-device", another)),
  ).rejects.toThrow("collide");
});

it("uses fixed ordinal ordering and rejects Windows ADS and punctuation", async () => {
  const version = (deviceId: string) => ({
    counter: 1,
    deviceId,
    eventId: "event",
  });
  expect(
    compareReplicationVersions(version("A-device"), version("a-device")),
  ).toBeLessThan(0);
  expect(
    compareReplicationVersions(version("device_"), version("device-")),
  ).toBeGreaterThan(0);

  const { root, a, input } = await setup();
  const original = join(root, "original.bin");
  await writeFile(original, "original");
  for (const path of [
    "files/name:stream",
    "files/question?.jpg",
    "files/trailing. ",
  ]) {
    const replica = new Replica();
    replica.change(path, { title: path }, [{ source: original, path }]);
    await expect(
      runLibraryReplicationCycle(
        input(`device-${a.changes.length}-${path.length}`, replica),
      ),
    ).rejects.toThrow("unsafe");
  }
});

it("rejects an unsafe Library identity before constructing exchange paths", async () => {
  const { b, input } = await setup();
  await expect(
    runLibraryReplicationCycle({
      ...input("device", b),
      libraryId: "../outside",
    }),
  ).rejects.toThrow();
  await expect(
    runLibraryReplicationCycle({
      ...input("device", b),
      libraryId: "CON",
    }),
  ).rejects.toThrow();
});

it("recovers an atomically published event after a crash before state commit", async () => {
  const { root, exchange, a, input } = await setup();
  a.change("one", { title: "one" });
  await expect(
    runLibraryReplicationCycle({
      ...input("a-device", a),
      afterPublish() {
        throw new Error("injected crash after publish");
      },
    }),
  ).rejects.toThrow("injected crash");
  const result = await runLibraryReplicationCycle(input("a-device", a));
  expect(result.published).toBe(1);
  expect(
    await readdir(
      join(
        exchange,
        "pond-replication-v1",
        "portable-library-id",
        "events",
        "a-device",
      ),
    ),
  ).toEqual(["0000000000000001-1"]);
  expect(
    JSON.parse(await readFile(join(root, "a-device", "state.json"), "utf8")),
  ).toMatchObject({
    localCursor: 1,
    lamport: 1,
  });
});
