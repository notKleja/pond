import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { JsonObject, JsonValue } from "@pond/schema/json";
import { z } from "zod";

const MANIFEST_LIMIT = 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024 * 1024;
const BUNDLE_LIMIT = 4 * 1024 * 1024 * 1024;
const ATTACHMENT_LIMIT = 10_000;
const CONFLICT_LIMIT = 1_000;
const ENTRY_LIMIT = 20_000;
const DEPTH_LIMIT = 16;
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const LibraryIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(SAFE_ID)
  .refine((value) => !WINDOWS_RESERVED.test(value));
const ReplicatedModelSchema = z.enum([
  "save",
  "tag",
  "tag_group",
  "tag_group_member",
  "saved_view",
  "folder",
  "save_folder",
]);
const ModelIdSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !["__proto__", "constructor", "prototype"].includes(value) &&
      Array.from(value).every((character) => character.charCodeAt(0) >= 32),
  );

const VersionSchema = z.object({
  counter: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deviceId: z.string().regex(SAFE_ID),
  eventId: z.string().regex(SAFE_ID),
});
export type ReplicationVersion = z.infer<typeof VersionSchema>;
const DeviceClockSchema = z.record(
  z.string().regex(SAFE_ID),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
);
type DeviceClock = z.infer<typeof DeviceClockSchema>;

const AttachmentSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative().max(FILE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const EventSchema = z
  .object({
    schema: z.literal(1),
    libraryId: LibraryIdSchema,
    version: VersionSchema,
    clock: DeviceClockSchema.optional().default({}),
    createdAt: z.string().datetime(),
    model: ReplicatedModelSchema,
    modelId: ModelIdSchema,
    tombstone: z.boolean(),
    snapshot: z.record(z.string(), z.json()).nullable(),
    attachments: z.array(AttachmentSchema).max(ATTACHMENT_LIMIT),
  })
  .superRefine((event, context) => {
    if (event.version.counter < 1)
      context.addIssue({
        code: "custom",
        path: ["version", "counter"],
        message: "Replication event counters start at one.",
      });
    for (const [deviceId, counter] of Object.entries(event.clock))
      if (counter >= event.version.counter)
        context.addIssue({
          code: "custom",
          path: ["clock", deviceId],
          message: "Causal counters must precede the event counter.",
        });
  });
export type ReplicationEvent = z.infer<typeof EventSchema>;

const ConflictDirectionSchema = z.enum(["local_won", "remote_won"]);
const ConflictSchema = z.object({
  id: z.string().min(1),
  model: ReplicatedModelSchema,
  modelId: ModelIdSchema,
  direction: ConflictDirectionSchema,
  loser: VersionSchema,
  winner: VersionSchema,
  detectedAt: z.string().datetime(),
});
const LegacyConflictSchema = z.object({
  entity: z.string(),
  loser: VersionSchema,
  winner: VersionSchema,
  detectedAt: z.string().datetime(),
});
const StateSchema = z.object({
  schema: z.literal(1),
  deviceId: z.string().regex(SAFE_ID),
  localCursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lamport: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  versions: z.record(z.string(), VersionSchema),
  clocks: z.record(z.string(), DeviceClockSchema).optional().default({}),
  conflicts: z
    .array(z.union([ConflictSchema, LegacyConflictSchema]))
    .max(CONFLICT_LIMIT),
});
type StoredReplicationState = z.infer<typeof StateSchema>;
export type ReplicationConflict = z.infer<typeof ConflictSchema>;
type ReplicationState = Omit<StoredReplicationState, "conflicts"> & {
  conflicts: ReplicationConflict[];
};

export interface ReplicationAttachment {
  source: string;
  path: string;
}

export interface LocalReplicationChange {
  cursor: number;
  model: string;
  modelId: string;
  tombstone: boolean;
  snapshot: JsonObject | null;
  attachments: readonly ReplicationAttachment[];
}

export interface AppliedReplicationEvent {
  event: ReplicationEvent;
  directory: string;
}

export interface LibraryReplicationAdapter {
  changesAfter(cursor: number): Promise<readonly LocalReplicationChange[]>;
  apply(incoming: AppliedReplicationEvent): Promise<void>;
}

export interface ReplicationFileOperations {
  rename?: (source: string, destination: string) => Promise<void>;
  delay?: (milliseconds: number) => Promise<void>;
}

export interface ReplicationCycleInput {
  libraryId: string;
  deviceId: string;
  exchangeDirectory: string;
  /** Device-local cursor and conflict state. This file is never part of the shared exchange. */
  stateFile: string;
  adapter: LibraryReplicationAdapter;
  now?: () => Date;
  afterPublish?: (event: ReplicationEvent) => void | Promise<void>;
  fileOperations?: ReplicationFileOperations;
}

export interface ReplicationCycleResult {
  published: number;
  applied: number;
  ignored: number;
  conflicts: number;
  incomplete: number;
  rejected: number;
}

function entityKey(model: string, modelId: string): string {
  return `${model}\0${modelId}`;
}

function conflictId(input: {
  model: string;
  modelId: string;
  loser: ReplicationVersion;
  winner: ReplicationVersion;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.model,
        input.modelId,
        input.loser.deviceId,
        input.loser.eventId,
        input.winner.deviceId,
        input.winner.eventId,
      ]),
    )
    .digest("hex");
}

function normalizeConflict(
  conflict: z.infer<typeof ConflictSchema | typeof LegacyConflictSchema>,
  localDeviceId: string,
): ReplicationConflict {
  if ("id" in conflict) return conflict;
  const separator = conflict.entity.indexOf("\0");
  const model = ReplicatedModelSchema.parse(
    separator < 0 ? conflict.entity : conflict.entity.slice(0, separator),
  );
  const modelId = ModelIdSchema.parse(
    separator < 0 ? conflict.entity : conflict.entity.slice(separator + 1),
  );
  return {
    id: conflictId({ model, modelId, ...conflict }),
    model,
    modelId,
    direction:
      conflict.winner.deviceId === localDeviceId ? "local_won" : "remote_won",
    loser: conflict.loser,
    winner: conflict.winner,
    detectedAt: conflict.detectedAt,
  };
}

function recordConflict(
  state: ReplicationState,
  input: {
    model: z.infer<typeof ReplicatedModelSchema>;
    modelId: string;
    loser: ReplicationVersion;
    winner: ReplicationVersion;
    detectedAt: string;
  },
): boolean {
  const id = conflictId(input);
  if (state.conflicts.some((conflict) => conflict.id === id)) return false;
  state.conflicts.push({
    id,
    model: input.model,
    modelId: input.modelId,
    direction:
      input.winner.deviceId === state.deviceId ? "local_won" : "remote_won",
    loser: input.loser,
    winner: input.winner,
    detectedAt: input.detectedAt,
  });
  if (state.conflicts.length > CONFLICT_LIMIT)
    state.conflicts.splice(0, state.conflicts.length - CONFLICT_LIMIT);
  return true;
}

function clockCounter(
  clock: DeviceClock,
  deviceId: string,
): number | undefined {
  return Object.hasOwn(clock, deviceId) ? clock[deviceId] : undefined;
}

function mergeClocks(...clocks: readonly DeviceClock[]): DeviceClock {
  const merged: DeviceClock = {};
  for (const clock of clocks)
    for (const [deviceId, counter] of Object.entries(clock))
      merged[deviceId] = Math.max(clockCounter(merged, deviceId) ?? 0, counter);
  return merged;
}

function withVersion(
  clock: DeviceClock,
  version: ReplicationVersion,
): DeviceClock {
  return mergeClocks(clock, { [version.deviceId]: version.counter });
}

function covers(clock: DeviceClock, version: ReplicationVersion): boolean {
  return (clockCounter(clock, version.deviceId) ?? 0) >= version.counter;
}

export function compareReplicationVersions(
  left: ReplicationVersion,
  right: ReplicationVersion,
): number {
  if (left.counter !== right.counter) return left.counter - right.counter;
  const device =
    left.deviceId < right.deviceId
      ? -1
      : left.deviceId > right.deviceId
        ? 1
        : 0;
  return (
    device ||
    (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0)
  );
}

function initialState(deviceId: string): ReplicationState {
  return {
    schema: 1,
    deviceId,
    localCursor: 0,
    lamport: 0,
    versions: {},
    clocks: {},
    conflicts: [],
  };
}

async function readState(
  file: string,
  deviceId: string,
): Promise<ReplicationState> {
  const raw = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!raw) return initialState(deviceId);
  const stored = StateSchema.parse(JSON.parse(raw));
  const normalizedConflicts = stored.conflicts.map((conflict) =>
    normalizeConflict(conflict, stored.deviceId),
  );
  const state: ReplicationState = {
    ...stored,
    clocks: { ...stored.clocks },
    conflicts: [
      ...new Map(
        normalizedConflicts.map((conflict) => [conflict.id, conflict]),
      ).values(),
    ],
  };
  for (const [key, version] of Object.entries(state.versions)) {
    const clock = state.clocks[key] ?? {};
    clock[version.deviceId] = Math.max(
      clockCounter(clock, version.deviceId) ?? 0,
      version.counter,
    );
    state.clocks[key] = clock;
  }
  if (state.deviceId !== deviceId)
    throw new Error("This replication state belongs to a different device.");
  return state;
}

async function writeState(
  file: string,
  state: ReplicationState,
  fileOperations?: ReplicationFileOperations,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), {
      flag: "wx",
      flush: true,
    });
    await renameReplicationPath(temporary, file, fileOperations);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function isTransientRenameError(error: Error): boolean {
  if (!("code" in error)) return false;
  return ["EBUSY", "EPERM", "EACCES"].includes(String(error.code));
}

async function defaultDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) =>
    setTimeout(resolveDelay, milliseconds),
  );
}

/** Retries only Windows/cloud lock failures; collision handling remains with the caller. */
export async function renameReplicationPath(
  source: string,
  destination: string,
  fileOperations: ReplicationFileOperations = {},
): Promise<void> {
  const renamePath = fileOperations.rename ?? rename;
  const delay = fileOperations.delay ?? defaultDelay;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renamePath(source, destination);
      return;
    } catch (error) {
      const delayMs = RENAME_RETRY_DELAYS_MS[attempt];
      if (
        !(error instanceof Error) ||
        !isTransientRenameError(error) ||
        delayMs === undefined
      )
        throw error;
      await delay(delayMs);
    }
  }
}

function portablePath(path: string): string {
  if (isAbsolute(path) || path.includes("\\"))
    throw new Error(
      "Replication attachment paths must be portable and relative.",
    );
  const normalized = path.split("/");
  if (
    normalized.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/.test(part) ||
        Array.from(part).some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        WINDOWS_RESERVED.test(part),
    )
  )
    throw new Error("Replication attachment path is unsafe.");
  return normalized.join("/");
}

function inside(root: string, path: string): string {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Replication path escapes its bundle.");
  return rel;
}

async function hashFile(
  path: string,
): Promise<{ size: number; sha256: string }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Replication attachments must be regular files.");
  if (metadata.size > FILE_LIMIT)
    throw new Error("Replication attachment is too large.");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    if (size > FILE_LIMIT)
      throw new Error("Replication attachment is too large.");
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

async function reusePublishedEvent(
  temporary: string,
  destination: string,
  libraryId: string,
  event: ReplicationEvent,
): Promise<ReplicationEvent | null> {
  let destinationMetadata: Awaited<ReturnType<typeof stat>>;
  try {
    destinationMetadata = await stat(destination);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  if (!destinationMetadata.isDirectory()) return null;
  const existing = await readEvent(destination, libraryId);
  const comparable = (value: ReplicationEvent) => ({
    ...value,
    createdAt: "",
  });
  if (
    JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(event))
  )
    throw new Error("Replication event destination has conflicting content.");
  await rm(temporary, { recursive: true, force: true });
  return existing;
}

async function publish(
  input: ReplicationCycleInput,
  state: ReplicationState,
  change: LocalReplicationChange,
  now: Date,
): Promise<ReplicationEvent> {
  state.lamport += 1;
  if (!Number.isSafeInteger(state.lamport))
    throw new Error("Replication counter is exhausted.");
  const eventId = `${String(state.lamport).padStart(16, "0")}-${change.cursor}`;
  const version = { counter: state.lamport, deviceId: input.deviceId, eventId };
  const clock = { ...state.clocks[entityKey(change.model, change.modelId)] };
  const parent = join(
    input.exchangeDirectory,
    "pond-replication-v1",
    input.libraryId,
    "events",
    input.deviceId,
  );
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.tmp-${randomUUID()}`);
  const destination = join(parent, eventId);
  await mkdir(temporary, { recursive: false });
  const attachments: ReplicationEvent["attachments"] = [];
  const portableNames = new Set<string>();
  let total = 0;
  try {
    for (const attachment of change.attachments) {
      const path = portablePath(attachment.path);
      const portableName = path.toLowerCase();
      if (portableNames.has(portableName))
        throw new Error("Replication attachment paths collide on Windows.");
      portableNames.add(portableName);
      const target = join(temporary, ...path.split("/"));
      inside(temporary, target);
      await mkdir(dirname(target), { recursive: true });
      if ((await lstat(attachment.source)).isSymbolicLink())
        throw new Error("Replication attachments must not be symbolic links.");
      const sourceReal = await realpath(attachment.source);
      const sourceMetadata = await lstat(sourceReal);
      if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile())
        throw new Error("Replication attachments must be regular files.");
      await copyFile(sourceReal, target);
      const digest = await hashFile(target);
      total += digest.size;
      if (total > BUNDLE_LIMIT)
        throw new Error("Replication event is too large.");
      attachments.push({ path, ...digest });
    }
    const event: ReplicationEvent = {
      schema: 1,
      libraryId: input.libraryId,
      version,
      clock,
      createdAt: now.toISOString(),
      model: ReplicatedModelSchema.parse(change.model),
      modelId: change.modelId,
      tombstone: change.tombstone,
      snapshot: change.tombstone ? null : change.snapshot,
      attachments,
    };
    EventSchema.parse(event);
    const manifest = JSON.stringify(event, null, 2);
    if (Buffer.byteLength(manifest) > MANIFEST_LIMIT)
      throw new Error("Replication manifest is too large.");
    await writeFile(join(temporary, "event.json"), manifest, {
      flag: "wx",
      flush: true,
    });
    await writeFile(join(temporary, "complete"), "1\n", {
      flag: "wx",
      flush: true,
    });
    const recovered = await reusePublishedEvent(
      temporary,
      destination,
      input.libraryId,
      event,
    );
    if (recovered) return recovered;
    try {
      await renameReplicationPath(temporary, destination, input.fileOperations);
      return event;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        !["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code))
      )
        throw error;
      const existing = await reusePublishedEvent(
        temporary,
        destination,
        input.libraryId,
        event,
      );
      if (!existing) throw error;
      return existing;
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function bundleEntries(
  root: string,
): Promise<{ files: string[]; directories: string[] }> {
  const pending = [{ directory: root, depth: 0 }];
  const files: string[] = [];
  const directories: string[] = [];
  let entries = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) continue;
    const { directory, depth } = next;
    if (depth > DEPTH_LIMIT)
      throw new Error("Replication bundle is nested too deeply.");
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink())
      throw new Error("Replication bundle contains a symbolic link.");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > ENTRY_LIMIT)
        throw new Error("Replication bundle contains too many entries.");
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Replication bundle contains a symbolic link.");
      if (entry.isDirectory()) {
        directories.push(relative(root, path).split(sep).join("/"));
        pending.push({ directory: path, depth: depth + 1 });
      } else if (entry.isFile())
        files.push(relative(root, path).split(sep).join("/"));
      else throw new Error("Replication bundle contains an unsupported entry.");
    }
  }
  return { files, directories };
}

async function readEvent(
  directory: string,
  libraryId: string,
): Promise<ReplicationEvent> {
  const entries = await bundleEntries(directory);
  const { files } = entries;
  let actualBytes = 0;
  for (const file of files) {
    actualBytes += (await stat(join(directory, ...file.split("/")))).size;
    if (actualBytes > BUNDLE_LIMIT + MANIFEST_LIMIT + 4096)
      throw new Error("Replication bundle is too large.");
  }
  const manifestPath = join(directory, "event.json");
  const manifestStat = await stat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.size > MANIFEST_LIMIT)
    throw new Error("Replication manifest is too large or invalid.");
  const event = EventSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (event.libraryId !== libraryId)
    throw new Error("Replication event belongs to a different Library.");
  if (
    basename(directory) !== event.version.eventId ||
    basename(dirname(directory)) !== event.version.deviceId
  )
    throw new Error("Replication event identity does not match its directory.");
  const declared = new Set([
    "event.json",
    "complete",
    ...event.attachments.map((item) => item.path),
  ]);
  const portableNames = new Set(
    event.attachments.map((item) => portablePath(item.path).toLowerCase()),
  );
  if (portableNames.size !== event.attachments.length)
    throw new Error("Replication attachment paths collide on Windows.");
  if (
    files.length !== declared.size ||
    files.some((path) => !declared.has(path))
  )
    throw new Error("Replication bundle contains unlisted or duplicate files.");
  const declaredDirectories = new Set<string>();
  for (const attachment of event.attachments) {
    const parts = attachment.path.split("/");
    for (let index = 1; index < parts.length; index += 1)
      declaredDirectories.add(parts.slice(0, index).join("/"));
  }
  if (
    entries.directories.length !== declaredDirectories.size ||
    entries.directories.some((path) => !declaredDirectories.has(path))
  )
    throw new Error("Replication bundle contains unlisted directories.");
  let total = 0;
  for (const attachment of event.attachments) {
    const path = portablePath(attachment.path);
    const target = join(directory, ...path.split("/"));
    inside(directory, target);
    const digest = await hashFile(target);
    total += digest.size;
    if (
      total > BUNDLE_LIMIT ||
      digest.size !== attachment.size ||
      digest.sha256 !== attachment.sha256
    )
      throw new Error("Replication attachment checksum does not match.");
  }
  return event;
}

async function eventDirectories(
  input: ReplicationCycleInput,
): Promise<{ complete: string[]; incomplete: number }> {
  const root = join(
    input.exchangeDirectory,
    "pond-replication-v1",
    input.libraryId,
    "events",
  );
  const complete: string[] = [];
  let incomplete = 0;
  for (const device of await readdir(root, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (
      !device.isDirectory() ||
      !SAFE_ID.test(device.name) ||
      device.name === input.deviceId
    )
      continue;
    const parent = join(root, device.name);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".tmp-")) {
        incomplete += 1;
        continue;
      }
      if (!SAFE_ID.test(entry.name)) continue;
      const directory = join(parent, entry.name);
      const committed = await stat(join(directory, "complete")).catch(
        () => null,
      );
      if (committed?.isFile()) complete.push(directory);
      else incomplete += 1;
    }
  }
  return { complete, incomplete };
}

export async function runLibraryReplicationCycle(
  input: ReplicationCycleInput,
): Promise<ReplicationCycleResult> {
  LibraryIdSchema.parse(input.libraryId);
  if (!SAFE_ID.test(input.deviceId))
    throw new Error("Replication device ID is invalid.");
  const state = await readState(input.stateFile, input.deviceId);
  const now = input.now ?? (() => new Date());
  let published = 0;
  for (const change of await input.adapter.changesAfter(state.localCursor)) {
    if (change.cursor <= state.localCursor)
      throw new Error("Replication adapter returned an invalid local cursor.");
    const event = await publish(input, state, change, now());
    await input.afterPublish?.(event);
    state.localCursor = change.cursor;
    const key = entityKey(event.model, event.modelId);
    state.versions[key] = event.version;
    state.clocks[key] = withVersion(event.clock, event.version);
    published += 1;
    await writeState(input.stateFile, state, input.fileOperations);
  }

  const discovered = await eventDirectories(input);
  const candidates: AppliedReplicationEvent[] = [];
  let rejected = 0;
  for (const directory of discovered.complete) {
    try {
      candidates.push({
        event: await readEvent(directory, input.libraryId),
        directory,
      });
    } catch {
      rejected += 1;
    }
  }
  candidates.sort((a, b) =>
    compareReplicationVersions(a.event.version, b.event.version),
  );

  let applied = 0;
  let ignored = 0;
  let conflicts = 0;
  for (const incoming of candidates) {
    const key = entityKey(incoming.event.model, incoming.event.modelId);
    const current = state.versions[key];
    const localClock = state.clocks[key] ?? {};
    if (covers(localClock, incoming.event.version)) {
      ignored += 1;
      continue;
    }
    const incomingDescendsCurrent = current
      ? covers(incoming.event.clock, current)
      : false;
    if (
      current &&
      compareReplicationVersions(incoming.event.version, current) <= 0
    ) {
      ignored += 1;
      state.clocks[key] = withVersion(
        mergeClocks(localClock, incoming.event.clock),
        incoming.event.version,
      );
      if (
        current.deviceId !== incoming.event.version.deviceId &&
        !incomingDescendsCurrent &&
        recordConflict(state, {
          model: incoming.event.model,
          modelId: incoming.event.modelId,
          loser: incoming.event.version,
          winner: current,
          detectedAt: now().toISOString(),
        })
      )
        conflicts += 1;
      await writeState(input.stateFile, state, input.fileOperations);
      continue;
    }
    try {
      await input.adapter.apply(incoming);
    } catch {
      rejected += 1;
      continue;
    }
    state.lamport = Math.max(state.lamport, incoming.event.version.counter);
    state.clocks[key] = withVersion(
      mergeClocks(localClock, incoming.event.clock),
      incoming.event.version,
    );
    if (
      current &&
      current.deviceId !== incoming.event.version.deviceId &&
      !incomingDescendsCurrent
    ) {
      if (
        recordConflict(state, {
          model: incoming.event.model,
          modelId: incoming.event.modelId,
          loser: current,
          winner: incoming.event.version,
          detectedAt: now().toISOString(),
        })
      )
        conflicts += 1;
    }
    state.versions[key] = incoming.event.version;
    applied += 1;
    await writeState(input.stateFile, state, input.fileOperations);
  }
  return {
    published,
    applied,
    ignored,
    conflicts,
    incomplete: discovered.incomplete,
    rejected,
  };
}

export async function readReplicationConflicts(
  stateFile: string,
  options: { deviceId: string; limit?: number },
): Promise<readonly ReplicationConflict[]> {
  const state = await readState(stateFile, options.deviceId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  return state.conflicts.slice(-limit).reverse();
}

export async function replicationConflictContainsVersion(
  stateFile: string,
  input: { deviceId: string; version: ReplicationVersion },
): Promise<boolean> {
  const version = VersionSchema.parse(input.version);
  const state = await readState(stateFile, input.deviceId);
  return state.conflicts.some((conflict) =>
    [conflict.loser, conflict.winner].some(
      (candidate) =>
        candidate.counter === version.counter &&
        candidate.deviceId === version.deviceId &&
        candidate.eventId === version.eventId,
    ),
  );
}

function replicationEventDirectory(input: {
  exchangeDirectory: string;
  libraryId: string;
  version: ReplicationVersion;
}): string {
  LibraryIdSchema.parse(input.libraryId);
  const version = VersionSchema.parse(input.version);
  return join(
    resolve(input.exchangeDirectory),
    "pond-replication-v1",
    input.libraryId,
    "events",
    version.deviceId,
    version.eventId,
  );
}

export async function verifyReplicationEventDirectory(input: {
  exchangeDirectory: string;
  libraryId: string;
  version: ReplicationVersion;
}): Promise<string> {
  const directory = replicationEventDirectory(input);
  const event = await readEvent(directory, input.libraryId);
  if (
    event.version.counter !== input.version.counter ||
    event.version.deviceId !== input.version.deviceId ||
    event.version.eventId !== input.version.eventId
  )
    throw new Error("Replication event identity does not match its history.");
  return directory;
}

void ((): JsonValue | null => null)();
