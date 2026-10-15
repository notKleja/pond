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

const AttachmentSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative().max(FILE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const EventSchema = z.object({
  schema: z.literal(1),
  libraryId: LibraryIdSchema,
  version: VersionSchema,
  createdAt: z.string().datetime(),
  model: ReplicatedModelSchema,
  modelId: ModelIdSchema,
  tombstone: z.boolean(),
  snapshot: z.record(z.string(), z.json()).nullable(),
  attachments: z.array(AttachmentSchema).max(ATTACHMENT_LIMIT),
});
export type ReplicationEvent = z.infer<typeof EventSchema>;

const ConflictSchema = z.object({
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
  conflicts: z.array(ConflictSchema).max(CONFLICT_LIMIT),
});
type ReplicationState = z.infer<typeof StateSchema>;

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

export interface ReplicationCycleInput {
  libraryId: string;
  deviceId: string;
  exchangeDirectory: string;
  stateFile: string;
  adapter: LibraryReplicationAdapter;
  now?: () => Date;
  afterPublish?: (event: ReplicationEvent) => void | Promise<void>;
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
  const state = StateSchema.parse(JSON.parse(raw));
  if (state.deviceId !== deviceId)
    throw new Error("This replication state belongs to a different device.");
  return state;
}

async function writeState(
  file: string,
  state: ReplicationState,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(state, null, 2), {
    flag: "wx",
    flush: true,
  });
  await rename(temporary, file);
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
      createdAt: now.toISOString(),
      model: ReplicatedModelSchema.parse(change.model),
      modelId: change.modelId,
      tombstone: change.tombstone,
      snapshot: change.tombstone ? null : change.snapshot,
      attachments,
    };
    EventSchema.parse(event);
    await writeFile(
      join(temporary, "event.json"),
      JSON.stringify(event, null, 2),
      {
        flag: "wx",
        flush: true,
      },
    );
    await writeFile(join(temporary, "complete"), "1\n", {
      flag: "wx",
      flush: true,
    });
    try {
      await rename(temporary, destination);
      return event;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        !["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code))
      )
        throw error;
      if (!(await stat(destination).catch(() => null))?.isDirectory())
        throw error;
      const existing = await readEvent(destination, input.libraryId);
      const comparable = (value: ReplicationEvent) => ({
        ...value,
        createdAt: "",
      });
      if (
        JSON.stringify(comparable(existing)) !==
        JSON.stringify(comparable(event))
      )
        throw new Error(
          "Replication event destination has conflicting content.",
        );
      await rm(temporary, { recursive: true, force: true });
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
    state.versions[entityKey(event.model, event.modelId)] = event.version;
    published += 1;
    await writeState(input.stateFile, state);
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
    if (
      current &&
      compareReplicationVersions(incoming.event.version, current) <= 0
    ) {
      ignored += 1;
      continue;
    }
    try {
      await input.adapter.apply(incoming);
    } catch {
      rejected += 1;
      continue;
    }
    state.lamport = Math.max(state.lamport, incoming.event.version.counter);
    if (current && current.deviceId !== incoming.event.version.deviceId) {
      state.conflicts.push({
        entity: key,
        loser: current,
        winner: incoming.event.version,
        detectedAt: now().toISOString(),
      });
      if (state.conflicts.length > CONFLICT_LIMIT)
        state.conflicts.splice(0, state.conflicts.length - CONFLICT_LIMIT);
      conflicts += 1;
    }
    state.versions[key] = incoming.event.version;
    applied += 1;
    await writeState(input.stateFile, state);
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
): Promise<readonly z.infer<typeof ConflictSchema>[]> {
  const value = JSON.parse(await readFile(stateFile, "utf8"));
  return StateSchema.parse(value).conflicts;
}

void ((): JsonValue | null => null)();
