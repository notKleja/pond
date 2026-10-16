import {
  isAuxiliaryKind,
  isOriginalImageKind,
  POSTER_KIND,
} from "@shared/save-file-names";
import sharp from "sharp";

const MAX_EDGE = 1024;

export async function renderThumbnail(
  input: string | Buffer,
): Promise<Buffer | null> {
  try {
    return await sharp(input, { failOn: "none", pages: 1 })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

export function thumbnailSource(
  files: readonly { kind: string; path: string }[],
): { kind: string; path: string } | undefined {
  return (
    files.find((file) => file.kind === POSTER_KIND) ??
    files.find((file) => isOriginalImageKind(file.kind)) ??
    files.find((file) => !isAuxiliaryKind(file.kind))
  );
}
