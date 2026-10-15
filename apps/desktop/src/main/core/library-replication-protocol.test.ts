import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
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
  replicationConflictContainsVersion,
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

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
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
  expect(first).toMatchObject({ applied: 0, ignored: 1, conflicts: 1 });
  const converged = await runLibraryReplicationCycle(input("a-device", a));
  expect(converged).toMatchObject({ applied: 1, conflicts: 1 });
  expect(a.entities.get("shared")).toEqual({ title: "B" });
  expect(
    await readReplicationConflicts(join(root, "a-device", "state.json"), {
      deviceId: "a-device",
    }),
  ).toMatchObject([
    {
      model: "save",
      modelId: "shared",
      direction: "remote_won",
      loser: { deviceId: "a-device", eventId: "0000000000000001-1" },
      winner: { deviceId: "z-device", eventId: "0000000000000001-1" },
    },
  ]);
  expect(
    await readReplicationConflicts(join(root, "z-device", "state.json"), {
      deviceId: "z-device",
    }),
  ).toMatchObject([
    {
      direction: "local_won",
      loser: { deviceId: "a-device", eventId: "0000000000000001-1" },
      winner: { deviceId: "z-device", eventId: "0000000000000001-1" },
    },
  ]);
  expect(
    await replicationConflictContainsVersion(
      join(root, "a-device", "state.json"),
      {
        deviceId: "a-device",
        version: {
          counter: 1,
          deviceId: "a-device",
          eventId: "0000000000000001-1",
        },
      },
    ),
  ).toBe(true);
  expect(
    await replicationConflictContainsVersion(
      join(root, "a-device", "state.json"),
      {
        deviceId: "a-device",
        version: {
          counter: 99,
          deviceId: "unrelated-device",
          eventId: "unrelated-event",
        },
      },
    ),
  ).toBe(false);
  expect((await runLibraryReplicationCycle(input("a-device", a))).applied).toBe(
    0,
  );
  expect(
    await readReplicationConflicts(join(root, "a-device", "state.json"), {
      deviceId: "a-device",
    }),
  ).toHaveLength(1);
});

it("does not report sequential edits or repeatedly warn about ancestors", async () => {
  const { root, a, b, input } = await setup();
  a.change("shared", { title: "A first" });
  await runLibraryReplicationCycle(input("a-device", a));
  await runLibraryReplicationCycle(input("z-device", b));

  b.change("shared", { title: "B after A" });
  await runLibraryReplicationCycle(input("z-device", b));
  const applied = await runLibraryReplicationCycle(input("a-device", a));
  expect(applied).toMatchObject({ applied: 1, conflicts: 0 });
  expect(a.entities.get("shared")).toEqual({ title: "B after A" });

  await runLibraryReplicationCycle(input("a-device", a));
  await runLibraryReplicationCycle(input("z-device", b));
  expect(
    await readReplicationConflicts(join(root, "a-device", "state.json"), {
      deviceId: "a-device",
    }),
  ).toEqual([]);
  expect(
    await readReplicationConflicts(join(root, "z-device", "state.json"), {
      deviceId: "z-device",
    }),
  ).toEqual([]);
});

it("treats successive edits from one device as causal updates", async () => {
  const { root, a, b, input } = await setup();
  a.change("shared", { title: "first" });
  a.change("shared", { title: "second" });
  const published = await runLibraryReplicationCycle(input("a-device", a));
  expect(published).toMatchObject({ published: 2, conflicts: 0 });
  const applied = await runLibraryReplicationCycle(input("z-device", b));
  expect(applied).toMatchObject({ applied: 2, conflicts: 0 });
  expect(b.entities.get("shared")).toEqual({ title: "second" });
  expect(
    await readReplicationConflicts(join(root, "z-device", "state.json"), {
      deviceId: "z-device",
    }),
  ).toEqual([]);
});

it("reads bounded durable history and migrates legacy conflict evidence", async () => {
  const { root } = await setup();
  const stateFile = join(root, "legacy-state.json");
  await writeFile(
    stateFile,
    JSON.stringify({
      schema: 1,
      deviceId: "local-device",
      localCursor: 2,
      lamport: 2,
      versions: {},
      conflicts: [
        {
          entity: "save\u0000first",
          loser: {
            counter: 1,
            deviceId: "remote-device",
            eventId: "remote-1",
          },
          winner: {
            counter: 2,
            deviceId: "local-device",
            eventId: "local-2",
          },
          detectedAt: "2026-10-15T12:00:00.000Z",
        },
        {
          entity: "folder\u0000second",
          loser: {
            counter: 1,
            deviceId: "local-device",
            eventId: "local-1",
          },
          winner: {
            counter: 2,
            deviceId: "remote-device",
            eventId: "remote-2",
          },
          detectedAt: "2026-10-15T13:00:00.000Z",
        },
      ],
    }),
  );
  expect(
    await readReplicationConflicts(stateFile, {
      deviceId: "local-device",
      limit: 1,
    }),
  ).toMatchObject([
    {
      model: "folder",
      modelId: "second",
      direction: "remote_won",
    },
  ]);
  expect(
    await readReplicationConflicts(stateFile, { deviceId: "local-device" }),
  ).toHaveLength(2);
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

it("retries transient state-file locks with bounded backoff", async () => {
  const { a, input } = await setup();
  a.change("one", { title: "one" });
  const cycle = input("windows-device", a);
  const delays: number[] = [];
  let stateRenameAttempts = 0;
  const result = await runLibraryReplicationCycle({
    ...cycle,
    fileOperations: {
      async rename(source, destination) {
        if (destination === cycle.stateFile) {
          stateRenameAttempts += 1;
          if (stateRenameAttempts < 3) throw errno("EBUSY");
        }
        await rename(source, destination);
      },
      async delay(milliseconds) {
        delays.push(milliseconds);
      },
    },
  });

  expect(result.published).toBe(1);
  expect(stateRenameAttempts).toBe(3);
  expect(delays).toEqual([25, 50]);
  expect(await readdir(join(cycle.stateFile, ".."))).toEqual(["state.json"]);
});

it("retries a transient exchange publish lock without weakening atomic publication", async () => {
  const { exchange, a, input } = await setup();
  a.change("one", { title: "one" });
  const eventDirectory = join(
    exchange,
    "pond-replication-v1",
    "portable-library-id",
    "events",
    "windows-device",
  );
  const destination = join(eventDirectory, "0000000000000001-1");
  const delays: number[] = [];
  let publishRenameAttempts = 0;
  const result = await runLibraryReplicationCycle({
    ...input("windows-device", a),
    fileOperations: {
      async rename(source, target) {
        if (target === destination) {
          publishRenameAttempts += 1;
          if (publishRenameAttempts < 3) throw errno("EACCES");
        }
        await rename(source, target);
      },
      async delay(milliseconds) {
        delays.push(milliseconds);
      },
    },
  });

  expect(result.published).toBe(1);
  expect(publishRenameAttempts).toBe(3);
  expect(delays).toEqual([25, 50]);
  expect(await readdir(eventDirectory)).toEqual(["0000000000000001-1"]);
});

it("stops after the bounded transient retry budget and cleans state staging", async () => {
  const { a, input } = await setup();
  a.change("one", { title: "one" });
  const cycle = input("windows-device", a);
  const locked = errno("EPERM", "state file remains locked");
  const delays: number[] = [];
  let stateRenameAttempts = 0;
  let caught: unknown;
  try {
    await runLibraryReplicationCycle({
      ...cycle,
      fileOperations: {
        async rename(source, destination) {
          if (destination === cycle.stateFile) {
            stateRenameAttempts += 1;
            throw locked;
          }
          await rename(source, destination);
        },
        async delay(milliseconds) {
          delays.push(milliseconds);
        },
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(locked);
  expect(stateRenameAttempts).toBe(6);
  expect(delays).toEqual([25, 50, 100, 200, 400]);
  expect(await readdir(join(cycle.stateFile, ".."))).toEqual([]);
});

it("cleans exchange staging when transient publish retries are exhausted", async () => {
  const { exchange, a, input } = await setup();
  a.change("one", { title: "one" });
  const eventDirectory = join(
    exchange,
    "pond-replication-v1",
    "portable-library-id",
    "events",
    "windows-device",
  );
  const destination = join(eventDirectory, "0000000000000001-1");
  const locked = errno("EBUSY", "exchange folder remains locked");
  const delays: number[] = [];
  let attempts = 0;
  let caught: unknown;
  try {
    await runLibraryReplicationCycle({
      ...input("windows-device", a),
      fileOperations: {
        async rename(source, target) {
          if (target === destination) {
            attempts += 1;
            throw locked;
          }
          await rename(source, target);
        },
        async delay(milliseconds) {
          delays.push(milliseconds);
        },
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(locked);
  expect(attempts).toBe(6);
  expect(delays).toEqual([25, 50, 100, 200, 400]);
  expect(await readdir(eventDirectory)).toEqual([]);
});

it("does not retry permanent rename failures and cleans state staging", async () => {
  const { a, input } = await setup();
  a.change("one", { title: "one" });
  const cycle = input("windows-device", a);
  const permanent = errno("EIO", "permanent storage failure");
  const delays: number[] = [];
  let stateRenameAttempts = 0;
  let caught: unknown;
  try {
    await runLibraryReplicationCycle({
      ...cycle,
      fileOperations: {
        async rename(source, destination) {
          if (destination === cycle.stateFile) {
            stateRenameAttempts += 1;
            throw permanent;
          }
          await rename(source, destination);
        },
        async delay(milliseconds) {
          delays.push(milliseconds);
        },
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(permanent);
  expect(stateRenameAttempts).toBe(1);
  expect(delays).toEqual([]);
  expect(await readdir(join(cycle.stateFile, ".."))).toEqual([]);
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

it("rejects unsafe or non-safe-integer causal clocks", async () => {
  const { exchange, a, b, input } = await setup();
  a.change("one", { title: "one" });
  await runLibraryReplicationCycle(input("a-device", a));
  const manifestPath = join(
    exchange,
    "pond-replication-v1",
    "portable-library-id",
    "events",
    "a-device",
    "0000000000000001-1",
    "event.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.clock = { "../unsafe": Number.MAX_SAFE_INTEGER + 1 };
  await writeFile(manifestPath, JSON.stringify(manifest));
  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 0,
    rejected: 1,
  });
  expect(b.entities.has("one")).toBe(false);
});

it("rejects zero, equal, and future causal counters without hiding a later valid event", async () => {
  const { exchange, a, b, input } = await setup();
  a.change("zero", { title: "zero" });
  a.change("equal", { title: "equal" });
  a.change("future", { title: "future" });
  a.change("valid", { title: "valid" });
  await runLibraryReplicationCycle(input("a-device", a));
  const events = join(
    exchange,
    "pond-replication-v1",
    "portable-library-id",
    "events",
    "a-device",
  );
  const zeroManifest = join(events, "0000000000000001-1", "event.json");
  const zero = JSON.parse(await readFile(zeroManifest, "utf8"));
  zero.version.counter = 0;
  await writeFile(zeroManifest, JSON.stringify(zero));
  const equalManifest = join(events, "0000000000000002-2", "event.json");
  const equal = JSON.parse(await readFile(equalManifest, "utf8"));
  equal.clock = { "other-device": equal.version.counter };
  await writeFile(equalManifest, JSON.stringify(equal));
  const futureManifest = join(events, "0000000000000003-3", "event.json");
  const future = JSON.parse(await readFile(futureManifest, "utf8"));
  future.clock = { "other-device": 1_000 };
  await writeFile(futureManifest, JSON.stringify(future));

  expect(await runLibraryReplicationCycle(input("z-device", b))).toMatchObject({
    applied: 1,
    rejected: 3,
  });
  expect(b.entities.has("zero")).toBe(false);
  expect(b.entities.has("equal")).toBe(false);
  expect(b.entities.has("future")).toBe(false);
  expect(b.entities.get("valid")).toEqual({ title: "valid" });
});

it("treats inherited object names as ordinary device IDs in causal clocks", async () => {
  const { a, b, input } = await setup();
  a.change("shared", { title: "first" });
  await runLibraryReplicationCycle(input("constructor", a));
  await runLibraryReplicationCycle(input("z-device", b));
  b.change("shared", { title: "second" });
  await runLibraryReplicationCycle(input("z-device", b));
  expect(
    await runLibraryReplicationCycle(input("constructor", a)),
  ).toMatchObject({ applied: 1, conflicts: 0 });
  expect(a.entities.get("shared")).toEqual({ title: "second" });
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
