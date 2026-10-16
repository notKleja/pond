import type { Save } from "@pond/schema/db";
import { saves } from "@pond/schema/db";
import {
  hasMediaThumbnail,
  primaryOriginalPath,
  TEXT_THUMBNAIL_WEBP_FILE,
  THUMBNAIL_DARK_KIND,
  THUMBNAIL_KIND,
  thumbnailFilename,
} from "@shared/save-file-names";
import { eq } from "drizzle-orm";
import log from "electron-log/main.js";
import sharp from "sharp";
import { getDb } from "../db";
import { saveFile } from "../paths";
import { persistSave } from "./persist-save";
import type { WriteFileArgs } from "./pipeline/workers/apply";
import { renderThumbnail, thumbnailSource } from "./save-thumbnail-file";

export { renderThumbnail };

function thumbnailWriteArgs(
  files: ReadonlyArray<{ kind: string; path: string }>,
  bytes: Buffer,
  width?: number,
  height?: number,
): WriteFileArgs {
  const primary = primaryOriginalPath(files);
  const write: WriteFileArgs = {
    kind: THUMBNAIL_KIND,
    filename: primary ? thumbnailFilename(primary) : TEXT_THUMBNAIL_WEBP_FILE,
    bytes,
    mimeType: "image/webp",
  };
  if (width) write.width = width;
  if (height) write.height = height;
  return write;
}

export const THUMBNAIL_REPLACE_KINDS = [THUMBNAIL_KIND];

export async function persistSaveThumbnail(
  saveId: string,
  bytes: Buffer,
  actorReason: string,
): Promise<boolean> {
  const db = await getDb();
  const row = db.select().from(saves).where(eq(saves.id, saveId)).all()[0];
  if (!row) return false;
  const meta = await sharp(bytes)
    .metadata()
    .catch(() => null);
  const updated = await persistSave(
    saveId,
    {},
    {
      actorReason,
      replaceFilesWithKind: THUMBNAIL_REPLACE_KINDS,
      newFiles: [
        thumbnailWriteArgs(
          row.files ?? [],
          bytes,
          meta?.width ?? undefined,
          meta?.height ?? undefined,
        ),
      ],
    },
  );
  return Boolean(updated);
}

export async function ensureSaveThumbnail(
  saveId: string,
  save?: Pick<Save, "files"> | null,
): Promise<void> {
  const files = save?.files;
  if (!files?.length) return;
  if (hasMediaThumbnail(files)) return;
  const primary = thumbnailSource(files);
  if (!primary) return;
  const thumbnail = await renderThumbnail(saveFile(saveId, primary.path));
  if (!thumbnail) return;
  const meta = await sharp(thumbnail)
    .metadata()
    .catch(() => null);
  try {
    await persistSave(
      saveId,
      {},
      {
        actorReason: "pipeline:ensure-thumbnail",
        replaceFilesWithKind: [THUMBNAIL_KIND, THUMBNAIL_DARK_KIND],
        newFiles: [
          thumbnailWriteArgs(
            files,
            thumbnail,
            meta?.width ?? undefined,
            meta?.height ?? undefined,
          ),
        ],
      },
    );
  } catch (err) {
    log.warn("[pond thumbnail] could not write sidecar", saveId, err);
  }
}
