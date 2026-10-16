import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { NewSave } from "@pond/schema/db";
import { classifyLibraryFile } from "@shared/file-format";
import type { OkFailure, OkResult } from "@shared/query-contracts-shared";
import type { SavesImportCounts } from "@shared/saves-contracts-shared";
import type { ManualSaveResult } from "@shared/saves-import-contracts";
import { hashImportFile } from "./duplicate-import";
import { createManualSave } from "./manual-import";
import { persistSave } from "./persist-save";
import { type EnqueueOneResult, enqueue } from "./pipeline/enqueue";
import { setSaveTags } from "./tags";

const FILE_CARD_TYPES = new Set([
  "audio",
  "file",
  "gif",
  "image",
  "img",
  "pdf",
  "photo",
  "picture",
  "video",
]);

interface MymindCard {
  id: string;
  type: string;
  title: string;
  url: string;
  content: string;
  note: string;
  tags: string[];
  created: Date | null;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseMymindCards(csv: string): MymindCard[] | null {
  const rows = parseCsvRows(csv);
  const header = rows[0]?.map((name) => name.trim().toLowerCase());
  if (!header) return null;
  const indexOf = (name: string) => header.indexOf(name);
  if (
    !["title", "url", "content", "note", "id"].some(
      (name) => indexOf(name) >= 0,
    )
  ) {
    return null;
  }
  return rows.slice(1).flatMap((cells) => {
    const value = (name: string) => cells[indexOf(name)]?.trim() ?? "";
    const title = value("title");
    const url = value("url");
    const content = value("content");
    const note = value("note");
    const type = value("type");
    if (!title && !url && !content && !note && !type) return [];
    const created = Date.parse(value("created"));
    return [
      {
        id: value("id"),
        type,
        title,
        url: /^https?:\/\//i.test(url) ? url : "",
        content,
        note,
        tags: value("tags")
          .split(",")
          .map((tag) => tag.trim().replace(/^#/, ""))
          .filter(Boolean),
        created: Number.isNaN(created) ? null : new Date(created),
      },
    ];
  });
}

function isMymindMediaFile(name: string): boolean {
  const file = classifyLibraryFile(name);
  return (
    file.mediaType === "image" ||
    file.mediaType === "video" ||
    file.mimeType === "application/pdf"
  );
}

/** Image and PDF rows have no text of their own. The export writes those as files beside the CSV. */
function isMymindFileCard(card: MymindCard): boolean {
  return (
    FILE_CARD_TYPES.has(card.type.toLowerCase()) &&
    !card.url &&
    !card.content &&
    !card.note
  );
}

export type MymindImportResult = OkResult<SavesImportCounts>;

export interface MymindImportDependencies {
  createSave: (
    input: Parameters<typeof createManualSave>[0],
  ) => Promise<ManualSaveResult>;
  enqueueLink: (url: string) => Promise<EnqueueOneResult>;
  persistLinkMetadata: (
    id: string,
    patch: Partial<NewSave>,
  ) => Promise<boolean>;
  setLinkTags: (id: string, tags: string[]) => Promise<OkResult>;
}

const defaultDependencies: MymindImportDependencies = {
  createSave: createManualSave,
  enqueueLink: (url) => enqueue(url, { trigger: "user:importMymind" }),
  persistLinkMetadata: async (id, patch) =>
    Boolean(await persistSave(id, patch, { actorReason: "mymind:import" })),
  setLinkTags: setSaveTags,
};

function fileCounts(files: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const key = file.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function failedImport(label: string, reason?: string): OkFailure {
  return {
    ok: false,
    error: reason
      ? `Couldn't import ${label}: ${reason}`
      : `Couldn't import ${label}.`,
  };
}

export async function importMymindExport(
  directory: string,
  dependencies: MymindImportDependencies = defaultDependencies,
): Promise<MymindImportResult> {
  let files: Dirent[];
  try {
    files = await readdir(directory, { withFileTypes: true });
  } catch {
    return failedImport("that mymind export", "the folder couldn't be read");
  }

  let cards: MymindCard[] | null = null;
  const cardsFile = files.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === "cards.csv",
  );
  if (cardsFile) {
    try {
      cards = parseMymindCards(
        await readFile(join(directory, cardsFile.name), "utf8"),
      );
    } catch {
      return failedImport("cards.csv", "the file couldn't be read");
    }
    if (!cards)
      return failedImport("cards.csv", "the file isn't a mymind export");
  }
  const media = files.filter(
    (entry) => entry.isFile() && isMymindMediaFile(entry.name),
  );
  const availableMedia = fileCounts(media.map((entry) => entry.name));
  const fileCardIds = new Map<string, string[]>();
  if (!cards && media.length === 0) {
    return {
      ok: false,
      error:
        "That folder doesn't include a mymind cards.csv or media files. Choose the folder from Export my mind.",
    };
  }
  let imported = 0;
  let skipped = 0;
  for (const card of cards ?? []) {
    if (isMymindFileCard(card)) {
      const filename = basename(card.title).toLocaleLowerCase();
      const available = availableMedia.get(filename) ?? 0;
      if (available > 0) {
        availableMedia.set(filename, available - 1);
        if (card.id) {
          const ids = fileCardIds.get(filename) ?? [];
          ids.push(card.id);
          fileCardIds.set(filename, ids);
        }
      } else skipped += 1;
      continue;
    }
    const note = [card.content, card.note].filter(Boolean).join("\n\n");
    if (card.url) {
      const result = await importMymindLink(card, note, dependencies);
      if (!result.ok) return result;
      if (result.skipped) skipped += 1;
      else imported += 1;
      continue;
    }
    const result = await dependencies.createSave({
      source: "local",
      sourceId: card.id ? `mymind:${card.id}` : undefined,
      title: card.title || null,
      url: card.url || null,
      note: note || null,
      tags: card.tags,
      savedAt: card.created ?? undefined,
      createdAt: card.created ?? undefined,
    });
    if (!result.ok)
      return failedImport(card.title || "a mymind Save", result.error);
    if (result.skipped) skipped += 1;
    else imported += 1;
  }
  for (const file of media) {
    const path = join(directory, file.name);
    const fileCardId = fileCardIds.get(file.name.toLocaleLowerCase())?.shift();
    let sourceId: string;
    try {
      sourceId = fileCardId
        ? `mymind:${fileCardId}`
        : `mymind-file:${await hashImportFile(path)}`;
    } catch {
      return failedImport(file.name, "the file couldn't be read");
    }
    const result = await dependencies.createSave({
      source: "local",
      sourceId,
      filePaths: [path],
    });
    if (!result.ok) return failedImport(file.name, result.error);
    if (result.skipped) skipped += 1;
    else imported += 1;
  }
  return { ok: true, imported, skipped };
}

async function importMymindLink(
  card: MymindCard,
  note: string,
  dependencies: MymindImportDependencies,
): Promise<{ ok: true; skipped: boolean } | { ok: false; error: string }> {
  let result: EnqueueOneResult;
  try {
    result = await dependencies.enqueueLink(card.url);
  } catch {
    return failedImport(card.title || card.url, "the link couldn't be queued");
  }
  if (!result.created) return { ok: true, skipped: true };
  try {
    if (card.tags.length > 0) {
      const tagged = await dependencies.setLinkTags(result.id, card.tags);
      if (!tagged.ok)
        return failedImport(
          card.title || card.url,
          tagged.error ?? "its tags couldn't be saved",
        );
    }
    const patch: Partial<NewSave> = {};
    if (note) patch.notes = note;
    if (card.created) {
      patch.savedAt = card.created;
      patch.createdAt = card.created;
    }
    if (Object.keys(patch).length > 0) {
      const persisted = await dependencies.persistLinkMetadata(
        result.id,
        patch,
      );
      if (!persisted)
        return failedImport(
          card.title || card.url,
          "its notes or dates couldn't be saved",
        );
    }
  } catch {
    return failedImport(
      card.title || card.url,
      "its metadata couldn't be saved",
    );
  }
  return { ok: true, skipped: false };
}
