import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  type Folder,
  folders,
  MEDIA_TYPES,
  type NewFolder,
  type NewSave,
  type NewSavedView,
  type NewTag,
  type NewTagGroup,
  SAVE_STATUSES,
  type Save,
  type SavedView,
  SOURCES,
  savedViews,
  saveFolders,
  saves,
  syncActions,
  type Tag,
  type TagGroup,
  tagGroupMembers,
  tagGroups,
  tags,
} from "@pond/schema/db";
import { QuerySchema } from "@pond/schema/filters";
import type { JsonObject, JsonValue } from "@pond/schema/json";
import type { Transaction, TxSaveFile } from "@pond/schema/tx";
import { and, asc, eq, gt } from "drizzle-orm";
import log from "electron-log/main.js";
import { z } from "zod";
import { getDb } from "../db";
import { appDataRoot, libraryId, libraryRoot, saveDir } from "../paths";
import {
  executeBatch,
  registerSyncActionListener,
  withMutationScope,
} from "./executor";
import {
  type AppliedReplicationEvent,
  type LibraryReplicationAdapter,
  type LocalReplicationChange,
  type ReplicationCycleResult,
  runLibraryReplicationCycle,
} from "./library-replication-protocol";

const ConfigSchema = z.object({
  schema: z.literal(1),
  libraries: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      exchangeDirectory: z.string().min(1),
      deviceId: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
        .optional(),
      intervalMs: z.number().int().min(5_000).max(3_600_000).optional(),
    }),
  ),
});

const DeviceSchema = z.object({
  schema: z.literal(1),
  deviceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
});
const JsonObjectSchema = z.record(z.string(), z.json());
const SaveFilePathSchema = z.object({ path: z.string().min(1) });
const StoredDateSchema = z.iso.datetime();
const NullableStoredDateSchema = StoredDateSchema.nullable();
const SaveFileSnapshotSchema = z
  .object({
    kind: z.string(),
    path: z.string().min(1),
    sha256: z.string(),
    size: z.number().int().nonnegative(),
    mimeType: z.string().nullable().optional(),
    width: z.number().int().nullable().optional(),
    height: z.number().int().nullable().optional(),
    family: z.string().nullable().optional(),
    subfamily: z.string().nullable().optional(),
    fontWeight: z.number().int().nullable().optional(),
    bpm: z.number().nullable().optional(),
  })
  .strict();
const SaveSnapshotSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(SOURCES),
    sourceId: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    author: z.string().nullable(),
    lang: z.string().nullable(),
    siteName: z.string().nullable(),
    publishedAt: NullableStoredDateSchema,
    notes: z.string().nullable(),
    mediaType: z.enum(MEDIA_TYPES).nullable(),
    tags: z.array(z.string()),
    listKinds: z.array(z.enum(["liked", "saved"])),
    files: z.array(SaveFileSnapshotSchema),
    coverIndex: z.number().int().nonnegative(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    fileSize: z.number().int().nullable(),
    container: z.string().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    bitrate: z.number().int().nullable(),
    colorSpace: z.string().nullable(),
    cameraMake: z.string().nullable(),
    cameraModel: z.string().nullable(),
    lensModel: z.string().nullable(),
    focalLength: z.number().nullable(),
    aperture: z.number().nullable(),
    exposureTime: z.string().nullable(),
    iso: z.number().int().nullable(),
    takenAt: NullableStoredDateSchema,
    metadataVersion: z.number().int().nullable(),
    phash: z.string().nullable(),
    blurhash: z.string().nullable(),
    embedding: z.array(z.number()).nullable(),
    embeddingModel: z.string().nullable(),
    caption: z.string().nullable(),
    captionModel: z.string().nullable(),
    ocrText: z.string().nullable(),
    ocrModel: z.string().nullable(),
    transcript: z.string().nullable(),
    transcriptModel: z.string().nullable(),
    clipEmbedding: z.array(z.number()).nullable(),
    clipModel: z.string().nullable(),
    aesthetic: z.array(z.string()).nullable(),
    aestheticModel: z.string().nullable(),
    sensitiveScore: z.number().nullable(),
    sensitiveModel: z.string().nullable(),
    autoTitleModel: z.string().nullable(),
    suggestedTags: z.array(z.string()).nullable(),
    suggestedTagsModel: z.string().nullable(),
    rating: z.number().int().nullable(),
    rotate: z.number().int(),
    flipX: z.boolean(),
    flipY: z.boolean(),
    crop: z
      .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
      .strict()
      .nullable(),
    dominantColors: z.array(z.string()),
    primaryColor: z.string().nullable(),
    status: z.enum(SAVE_STATUSES),
    deletedAt: NullableStoredDateSchema,
    savedAt: StoredDateSchema,
    createdAt: StoredDateSchema,
  })
  .strict();
const TagSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    starred: z.boolean(),
    archived: z.boolean(),
    lastUsedAt: NullableStoredDateSchema,
    usageCount: z.number().int(),
    createdAt: StoredDateSchema,
  })
  .strict();
const TagGroupSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    sortOrder: z.number().int(),
    collapsed: z.boolean(),
    createdAt: StoredDateSchema,
  })
  .strict();
const TagGroupMemberSnapshotSchema = z
  .object({
    tagId: z.string().min(1),
    groupId: z.string().min(1),
    sortOrder: z.number().int(),
  })
  .strict();
const FolderSnapshotSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().nullable(),
    name: z.string(),
    color: z.string().nullable(),
    sortOrder: z.number().int(),
    createdAt: StoredDateSchema,
  })
  .strict();
const SavedViewSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.enum(["saved_view", "smart_folder", "group"]),
    parentId: z.string().nullable(),
    question: z.string().nullable(),
    query: QuerySchema,
    sortKey: z.string(),
    sortDir: z.string(),
    layout: z.string().nullable(),
    sortOrder: z.number().int(),
    createdAt: StoredDateSchema,
  })
  .strict();
const SaveFolderSnapshotSchema = z
  .object({ id: z.string().min(1), folderIds: z.array(z.string()) })
  .strict();

type StoredReplicationSnapshot =
  | z.infer<typeof SaveSnapshotSchema>
  | z.infer<typeof TagSnapshotSchema>
  | z.infer<typeof TagGroupSnapshotSchema>
  | z.infer<typeof TagGroupMemberSnapshotSchema>
  | z.infer<typeof FolderSnapshotSchema>
  | z.infer<typeof SavedViewSnapshotSchema>
  | z.infer<typeof SaveFolderSnapshotSchema>;

function json(value: StoredReplicationSnapshot): JsonObject {
  return JsonObjectSchema.parse(JSON.parse(JSON.stringify(value)));
}

function storedDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function saveSnapshot(row: Save): JsonObject {
  return json(
    SaveSnapshotSchema.parse({
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      url: row.url,
      title: row.title,
      description: row.description,
      author: row.author,
      lang: row.lang,
      siteName: row.siteName,
      publishedAt: storedDate(row.publishedAt),
      notes: row.notes,
      mediaType: row.mediaType,
      tags: row.tags,
      listKinds: row.listKinds,
      files: row.files.map(({ sourceUrl: _secretSourceUrl, ...file }) => file),
      coverIndex: row.coverIndex,
      width: row.width,
      height: row.height,
      fileSize: row.fileSize,
      container: row.container,
      videoCodec: row.videoCodec,
      audioCodec: row.audioCodec,
      bitrate: row.bitrate,
      colorSpace: row.colorSpace,
      cameraMake: row.cameraMake,
      cameraModel: row.cameraModel,
      lensModel: row.lensModel,
      focalLength: row.focalLength,
      aperture: row.aperture,
      exposureTime: row.exposureTime,
      iso: row.iso,
      takenAt: storedDate(row.takenAt),
      metadataVersion: row.metadataVersion,
      phash: row.phash,
      blurhash: row.blurhash,
      embedding: row.embedding,
      embeddingModel: row.embeddingModel,
      caption: row.caption,
      captionModel: row.captionModel,
      ocrText: row.ocrText,
      ocrModel: row.ocrModel,
      transcript: row.transcript,
      transcriptModel: row.transcriptModel,
      clipEmbedding: row.clipEmbedding,
      clipModel: row.clipModel,
      aesthetic: row.aesthetic,
      aestheticModel: row.aestheticModel,
      sensitiveScore: row.sensitiveScore,
      sensitiveModel: row.sensitiveModel,
      autoTitleModel: row.autoTitleModel,
      suggestedTags: row.suggestedTags,
      suggestedTagsModel: row.suggestedTagsModel,
      rating: row.rating,
      rotate: row.rotate,
      flipX: row.flipX,
      flipY: row.flipY,
      crop: row.crop,
      dominantColors: row.dominantColors,
      primaryColor: row.primaryColor,
      status: row.status,
      deletedAt: storedDate(row.deletedAt),
      savedAt: row.savedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }),
  );
}

async function localDeviceId(): Promise<string> {
  const file = join(appDataRoot(), "replication-device.json");
  const stored = await readFile(file, "utf8").catch(() => null);
  if (stored) return DeviceSchema.parse(JSON.parse(stored)).deviceId;
  const deviceId = `device-${randomUUID()}`;
  await writeFile(file, JSON.stringify({ schema: 1, deviceId }, null, 2), {
    flag: "wx",
    flush: true,
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return DeviceSchema.parse(JSON.parse(await readFile(file, "utf8"))).deviceId;
}

async function configured() {
  const file = join(appDataRoot(), "library-replication.json");
  const raw = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!raw) return null;
  const config = ConfigSchema.parse(JSON.parse(raw));
  const entry = config.libraries[libraryId()];
  if (!entry?.enabled) return null;
  return {
    ...entry,
    deviceId: entry.deviceId ?? (await localDeviceId()),
    intervalMs: entry.intervalMs ?? 30_000,
  };
}

let lastResult: ReplicationCycleResult | null = null;
let lastError: string | null = null;
let lastRunAt: string | null = null;

export async function getLibraryReplicationStatus() {
  const config = await configured();
  return {
    enabled: Boolean(config),
    exchangeDirectory: config?.exchangeDirectory ?? null,
    deviceId: config?.deviceId ?? null,
    lastRunAt,
    lastError,
    lastResult,
  };
}

export async function setLibraryReplicationDirectory(
  exchangeDirectory: string | null,
): Promise<void> {
  const file = join(appDataRoot(), "library-replication.json");
  const raw = await readFile(file, "utf8").catch(() => null);
  const current = raw
    ? ConfigSchema.parse(JSON.parse(raw))
    : { schema: 1 as const, libraries: {} };
  if (exchangeDirectory) {
    const exchange = resolve(exchangeDirectory);
    const library = resolve(libraryRoot());
    if (
      exchange === library ||
      exchange.startsWith(`${library}${sep}`) ||
      library.startsWith(`${exchange}${sep}`)
    )
      throw new Error("Choose an exchange folder outside the local Library.");
    await mkdir(exchange, { recursive: true });
    current.libraries[libraryId()] = {
      enabled: true,
      exchangeDirectory: exchange,
    };
  } else {
    delete current.libraries[libraryId()];
  }
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(current, null, 2), {
    flag: "wx",
    flush: true,
  });
  await import("node:fs/promises").then(({ rename }) =>
    rename(temporary, file),
  );
  await stopLibraryReplication();
  await startLibraryReplication();
}

type PondDb = Awaited<ReturnType<typeof getDb>>;

export interface PondReplicationRuntime {
  db(): Promise<PondDb>;
  saveDirectory(id: string): string;
  execute(transactions: Transaction[]): Promise<void>;
}

const defaultRuntime: PondReplicationRuntime = {
  db: getDb,
  saveDirectory: saveDir,
  async execute(transactions) {
    await executeBatch(transactions, { silent: false });
  },
};

function safeSaveAttachment(rootDirectory: string, path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("A Save contains an unsafe replication path.");
  const root = resolve(rootDirectory);
  const source = resolve(root, ...path.split("/"));
  if (!source.startsWith(`${root}${sep}`))
    throw new Error("A Save attachment is outside its Library item.");
  return { source, path: `files/${path}` };
}

export class PondReplicationAdapter implements LibraryReplicationAdapter {
  constructor(
    private readonly runtime: PondReplicationRuntime = defaultRuntime,
  ) {}

  async changesAfter(
    cursor: number,
  ): Promise<readonly LocalReplicationChange[]> {
    const db = await this.runtime.db();
    const actions = await db
      .select()
      .from(syncActions)
      .where(gt(syncActions.id, cursor))
      .orderBy(asc(syncActions.id));
    const changes: LocalReplicationChange[] = [];
    for (const action of actions) {
      if (action.actorReason?.startsWith("replication:")) continue;
      const tombstone = action.action === "D";
      const snapshot = tombstone
        ? null
        : await this.snapshot(
            action.modelName,
            action.modelId,
            z.json().parse(action.data),
          );
      if (!tombstone && !snapshot) continue;
      let attachments: LocalReplicationChange["attachments"] = [];
      if (action.modelName === "save" && snapshot) {
        const listed = z.array(SaveFilePathSchema).parse(snapshot.files ?? []);
        attachments = listed.map((entry) =>
          safeSaveAttachment(
            this.runtime.saveDirectory(action.modelId),
            entry.path,
          ),
        );
      }
      changes.push({
        cursor: action.id,
        model: action.modelName,
        modelId: action.modelId,
        tombstone,
        snapshot,
        attachments,
      });
    }
    return changes;
  }

  private async snapshot(
    model: string,
    id: string,
    actionData: JsonValue,
  ): Promise<JsonObject | null> {
    const db = await this.runtime.db();
    if (model === "save") {
      const row = await db.select().from(saves).where(eq(saves.id, id)).get();
      if (!row) return null;
      return saveSnapshot(row);
    }
    if (model === "tag") {
      const row = await db.select().from(tags).where(eq(tags.id, id)).get();
      return row
        ? json(
            TagSnapshotSchema.parse({
              ...row,
              lastUsedAt: storedDate(row.lastUsedAt),
              createdAt: row.createdAt.toISOString(),
            }),
          )
        : null;
    }
    if (model === "tag_group") {
      const row = await db
        .select()
        .from(tagGroups)
        .where(eq(tagGroups.id, id))
        .get();
      return row
        ? json(
            TagGroupSnapshotSchema.parse({
              ...row,
              createdAt: row.createdAt.toISOString(),
            }),
          )
        : null;
    }
    if (model === "saved_view") {
      const row = await db
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, id))
        .get();
      return row
        ? json(
            SavedViewSnapshotSchema.parse({
              ...row,
              createdAt: row.createdAt.toISOString(),
            }),
          )
        : null;
    }
    if (model === "folder") {
      const row = await db
        .select()
        .from(folders)
        .where(eq(folders.id, id))
        .get();
      return row
        ? json(
            FolderSnapshotSchema.parse({
              ...row,
              createdAt: row.createdAt.toISOString(),
            }),
          )
        : null;
    }
    if (model === "save_folder") {
      const rows = await db
        .select({ folderId: saveFolders.folderId })
        .from(saveFolders)
        .where(eq(saveFolders.saveId, id));
      return json(
        SaveFolderSnapshotSchema.parse({
          id,
          folderIds: rows.map((row) => row.folderId).sort(),
        }),
      );
    }
    if (model === "tag_group_member") {
      const parsed = TagGroupMemberSnapshotSchema.safeParse(actionData);
      if (
        parsed.success &&
        `${parsed.data.tagId}:${parsed.data.groupId}` === id
      )
        return parsed.data;
    }
    return null;
  }

  async apply({ event, directory }: AppliedReplicationEvent): Promise<void> {
    const tx = await this.transactionFor(event, directory);
    if (tx) await this.runtime.execute([tx]);
  }

  private async transactionFor(
    event: AppliedReplicationEvent["event"],
    directory: string,
  ): Promise<Transaction | null> {
    const db = await this.runtime.db();
    const meta = {
      actor: "system" as const,
      actorReason: `replication:${event.version.deviceId}:${event.version.eventId}`,
    };
    if (event.model === "save") {
      const current = await db
        .select()
        .from(saves)
        .where(eq(saves.id, event.modelId))
        .get();
      if (event.tombstone)
        return current
          ? {
              kind: "delete",
              model: "save",
              id: event.modelId,
              before: current,
              meta,
            }
          : null;
      if (!event.snapshot) return null;
      const stored = SaveSnapshotSchema.parse(event.snapshot);
      if (stored.id !== event.modelId)
        throw new Error("Replicated Save identity does not match its event.");
      const data = {
        ...stored,
        publishedAt: stored.publishedAt ? new Date(stored.publishedAt) : null,
        takenAt: stored.takenAt ? new Date(stored.takenAt) : null,
        deletedAt: stored.deletedAt ? new Date(stored.deletedAt) : null,
        savedAt: new Date(stored.savedAt),
        createdAt: new Date(stored.createdAt),
      } satisfies NewSave;
      const { id: _id, ...patch } = data;
      const files: TxSaveFile[] = [];
      const listed = stored.files;
      for (const entry of listed) {
        const expected = `files/${entry.path}`;
        if (
          !event.attachments.some((attachment) => attachment.path === expected)
        )
          throw new Error("Replicated Save is missing an original.");
        files.push({
          filename: entry.path,
          bytes: await readFile(join(directory, ...expected.split("/"))),
        });
      }
      return current
        ? {
            kind: "update",
            model: "save",
            id: event.modelId,
            patch,
            before: current,
            files,
            meta,
          }
        : {
            kind: "create",
            model: "save",
            id: event.modelId,
            data,
            files,
            meta,
          };
    }
    if (event.model === "save_folder") {
      const current = (
        await db
          .select({ folderId: saveFolders.folderId })
          .from(saveFolders)
          .where(eq(saveFolders.saveId, event.modelId))
      ).map((row) => row.folderId);
      const stored = event.tombstone
        ? { id: event.modelId, folderIds: [] }
        : SaveFolderSnapshotSchema.parse(event.snapshot);
      if (stored.id !== event.modelId)
        throw new Error(
          "Replicated folder membership identity does not match its event.",
        );
      const folderIds = stored.folderIds;
      return {
        kind: "update",
        model: "save_folder",
        id: event.modelId,
        before: { folderIds: current },
        patch: { folderIds },
        meta,
      };
    }
    if (event.model === "tag") {
      const current = await db
        .select()
        .from(tags)
        .where(eq(tags.id, event.modelId))
        .get();
      return tagTransaction(
        event.modelId,
        event.tombstone,
        event.snapshot,
        current,
        meta,
      );
    }
    if (event.model === "tag_group") {
      const current = await db
        .select()
        .from(tagGroups)
        .where(eq(tagGroups.id, event.modelId))
        .get();
      return tagGroupTransaction(
        event.modelId,
        event.tombstone,
        event.snapshot,
        current,
        meta,
      );
    }
    if (event.model === "saved_view") {
      const current = await db
        .select()
        .from(savedViews)
        .where(eq(savedViews.id, event.modelId))
        .get();
      return savedViewTransaction(
        event.modelId,
        event.tombstone,
        event.snapshot,
        current,
        meta,
      );
    }
    if (event.model === "folder") {
      const current = await db
        .select()
        .from(folders)
        .where(eq(folders.id, event.modelId))
        .get();
      return folderTransaction(
        event.modelId,
        event.tombstone,
        event.snapshot,
        current,
        meta,
      );
    }
    if (event.model === "tag_group_member") {
      const separator = event.modelId.indexOf(":");
      const identity =
        separator > 0 && separator < event.modelId.length - 1
          ? {
              tagId: event.modelId.slice(0, separator),
              groupId: event.modelId.slice(separator + 1),
            }
          : null;
      const data = event.snapshot
        ? TagGroupMemberSnapshotSchema.parse(event.snapshot)
        : identity
          ? { ...identity, sortOrder: 0 }
          : null;
      if (!data)
        throw new Error(
          "Replicated tag-group membership has an invalid identity.",
        );
      if (`${data.tagId}:${data.groupId}` !== event.modelId)
        throw new Error(
          "Replicated tag-group membership identity does not match its event.",
        );
      const current = await db
        .select()
        .from(tagGroupMembers)
        .where(
          and(
            eq(tagGroupMembers.tagId, data.tagId),
            eq(tagGroupMembers.groupId, data.groupId),
          ),
        )
        .get();
      if (event.tombstone)
        return current
          ? {
              kind: "delete",
              model: "tag_group_member",
              id: event.modelId,
              before: current,
              meta,
            }
          : null;
      return current
        ? null
        : {
            kind: "create",
            model: "tag_group_member",
            id: event.modelId,
            data,
            meta,
          };
    }
    return null;
  }
}

interface ReplicationMeta {
  actor: "system";
  actorReason: string;
}

function tagTransaction(
  id: string,
  tombstone: boolean,
  snapshot: JsonObject | null,
  current: Tag | undefined,
  meta: ReplicationMeta,
): Transaction | null {
  if (tombstone) {
    return current
      ? { kind: "delete", model: "tag", id, before: current, meta }
      : null;
  }
  if (!snapshot) return null;
  const stored = TagSnapshotSchema.parse(snapshot);
  if (stored.id !== id)
    throw new Error("Replicated Tag identity does not match its event.");
  const data = {
    ...stored,
    lastUsedAt: stored.lastUsedAt ? new Date(stored.lastUsedAt) : null,
    createdAt: new Date(stored.createdAt),
  } satisfies NewTag;
  const { id: _id, ...patch } = data;
  return current
    ? {
        kind: "update",
        model: "tag",
        id,
        patch,
        before: current,
        meta,
      }
    : { kind: "create", model: "tag", id, data, meta };
}

function tagGroupTransaction(
  id: string,
  tombstone: boolean,
  snapshot: JsonObject | null,
  current: TagGroup | undefined,
  meta: ReplicationMeta,
): Transaction | null {
  if (tombstone)
    return current
      ? { kind: "delete", model: "tag_group", id, before: current, meta }
      : null;
  if (!snapshot) return null;
  const stored = TagGroupSnapshotSchema.parse(snapshot);
  if (stored.id !== id)
    throw new Error("Replicated Tag Group identity does not match its event.");
  const data = {
    ...stored,
    createdAt: new Date(stored.createdAt),
  } satisfies NewTagGroup;
  const { id: _id, ...patch } = data;
  return current
    ? { kind: "update", model: "tag_group", id, patch, before: current, meta }
    : { kind: "create", model: "tag_group", id, data, meta };
}

function savedViewTransaction(
  id: string,
  tombstone: boolean,
  snapshot: JsonObject | null,
  current: SavedView | undefined,
  meta: ReplicationMeta,
): Transaction | null {
  if (tombstone)
    return current
      ? { kind: "delete", model: "saved_view", id, before: current, meta }
      : null;
  if (!snapshot) return null;
  const stored = SavedViewSnapshotSchema.parse(snapshot);
  if (stored.id !== id)
    throw new Error("Replicated Saved View identity does not match its event.");
  const data = {
    ...stored,
    createdAt: new Date(stored.createdAt),
  } satisfies NewSavedView;
  const { id: _id, ...patch } = data;
  return current
    ? { kind: "update", model: "saved_view", id, patch, before: current, meta }
    : { kind: "create", model: "saved_view", id, data, meta };
}

function folderTransaction(
  id: string,
  tombstone: boolean,
  snapshot: JsonObject | null,
  current: Folder | undefined,
  meta: ReplicationMeta,
): Transaction | null {
  if (tombstone)
    return current
      ? { kind: "delete", model: "folder", id, before: current, meta }
      : null;
  if (!snapshot) return null;
  const stored = FolderSnapshotSchema.parse(snapshot);
  if (stored.id !== id)
    throw new Error("Replicated Folder identity does not match its event.");
  const data = {
    ...stored,
    createdAt: new Date(stored.createdAt),
  } satisfies NewFolder;
  const { id: _id, ...patch } = data;
  return current
    ? { kind: "update", model: "folder", id, patch, before: current, meta }
    : { kind: "create", model: "folder", id, data, meta };
}

export function createReplicationRunCoordinator(
  runExclusive: (operation: () => Promise<void>) => Promise<void>,
) {
  let active: Promise<void> | null = null;
  return {
    run(operation: () => Promise<void>): Promise<void> {
      if (active) return active;
      active = runExclusive(operation).finally(() => {
        active = null;
      });
      return active;
    },
    async drain(): Promise<void> {
      await active;
    },
  };
}

const replicationRuns = createReplicationRunCoordinator(withMutationScope);
let timer: NodeJS.Timeout | null = null;
let unregister: (() => void) | null = null;

async function runConfiguredLibraryReplication(): Promise<void> {
  return replicationRuns.run(async () => {
    try {
      const activeLibraryId = libraryId();
      const activeLibraryRoot = libraryRoot();
      const config = await configured();
      if (!config) return;
      const root = resolve(config.exchangeDirectory);
      if (!existsSync(root)) await mkdir(root, { recursive: true });
      const result = await runLibraryReplicationCycle({
        libraryId: activeLibraryId,
        deviceId: config.deviceId,
        exchangeDirectory: root,
        stateFile: join(
          appDataRoot(),
          "replication",
          `${activeLibraryId}-${config.deviceId}.json`,
        ),
        adapter: new PondReplicationAdapter({
          ...defaultRuntime,
          saveDirectory: (id) => join(activeLibraryRoot, "items", `${id}.info`),
        }),
      });
      lastResult = result;
      lastError = null;
      lastRunAt = new Date().toISOString();
      if (result.published || result.applied || result.conflicts)
        log.info("[pond replication] cycle", result);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      lastRunAt = new Date().toISOString();
      throw error;
    }
  });
}

export async function startLibraryReplication(): Promise<void> {
  const config = await configured();
  if (!config || timer) return;
  const run = () =>
    void runConfiguredLibraryReplication().catch((error) =>
      log.warn("[pond replication] cycle failed", error),
    );
  unregister = registerSyncActionListener((action) => {
    if (!action.actorReason?.startsWith("replication:")) run();
  });
  timer = setInterval(run, config.intervalMs);
  timer.unref();
  run();
}

export async function stopLibraryReplication(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  unregister?.();
  unregister = null;
  await replicationRuns.drain();
}
