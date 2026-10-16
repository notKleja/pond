import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NewSave } from "@pond/schema/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ManualSaveInput } from "./manual-import";
import {
  importMymindExport,
  type MymindImportDependencies,
} from "./mymind-import";

let root = "";
let exportDirectory = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pond-mymind-import-"));
  exportDirectory = join(root, "export");
  await mkdir(exportDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(exportDirectory, "cards.csv"),
      [
        "id,type,title,url,content,note,tags,created",
        'link-1,WebPage,"An article, with a comma",https://example.com/article,,"Line one\nLine two","research, #reference",2024-03-01T12:00:00.000Z',
        "note-1,Note,A note,,Note body,,personal,2024-03-02T12:00:00.000Z",
        "image-1,Image,missing.png,,,,,2024-03-03T12:00:00.000Z",
        "video-1,Video,clip.webm,,,,,2024-03-04T12:00:00.000Z",
      ].join("\n"),
    ),
    writeFile(join(exportDirectory, "clip.webm"), "video"),
    writeFile(join(exportDirectory, "design.psd"), "image"),
    writeFile(join(exportDirectory, "archive.mkv"), "video"),
  ]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface ImportFixture {
  dependencies: MymindImportDependencies;
  links: Map<string, { id: string; metadata: Partial<NewSave> }>;
  saves: Map<string, ManualSaveInput>;
}

function createImportFixture(): ImportFixture {
  const links = new Map<string, { id: string; metadata: Partial<NewSave> }>();
  const saves = new Map<string, ManualSaveInput>();
  return {
    links,
    saves,
    dependencies: {
      async createSave(input) {
        const sourceId = input.sourceId ?? `generated:${saves.size}`;
        if (saves.has(sourceId))
          return { ok: true, id: sourceId, skipped: true };
        saves.set(sourceId, input);
        return { ok: true, id: sourceId };
      },
      async enqueueLink(url) {
        const current = links.get(url);
        if (current) return { id: current.id, created: false };
        const id = `link:${links.size}`;
        links.set(url, { id, metadata: {} });
        return { id, created: true };
      },
      async persistLinkMetadata(id, patch) {
        const link = [...links.values()].find(
          (candidate) => candidate.id === id,
        );
        if (!link) return false;
        Object.assign(link.metadata, patch);
        return true;
      },
      async setLinkTags(id, tags) {
        const link = [...links.values()].find(
          (candidate) => candidate.id === id,
        );
        if (!link) return { ok: false, error: "Save not found." };
        link.metadata.tags = tags;
        return { ok: true };
      },
    },
  };
}

describe("importMymindExport", () => {
  it("imports CSV metadata and supported media, reports missing files, and preserves edits on repeat", async () => {
    const fixture = createImportFixture();
    const first = await importMymindExport(
      exportDirectory,
      fixture.dependencies,
    );
    expect(first).toEqual({ ok: true, imported: 5, skipped: 1 });

    const link = fixture.links.get("https://example.com/article");
    expect(link?.metadata).toMatchObject({
      notes: "Line one\nLine two",
      tags: ["research", "reference"],
      savedAt: new Date("2024-03-01T12:00:00.000Z"),
      createdAt: new Date("2024-03-01T12:00:00.000Z"),
    });
    expect(fixture.saves.get("mymind:note-1")).toMatchObject({
      note: "Note body",
      tags: ["personal"],
      savedAt: new Date("2024-03-02T12:00:00.000Z"),
    });
    expect(fixture.saves.get("mymind:video-1")?.filePaths).toEqual([
      join(exportDirectory, "clip.webm"),
    ]);

    if (!link) throw new Error("Expected the link fixture to exist.");
    link.metadata = { notes: "Edited in Pond", tags: ["pond-only"] };
    const second = await importMymindExport(
      exportDirectory,
      fixture.dependencies,
    );
    expect(second).toEqual({ ok: true, imported: 0, skipped: 6 });
    expect(link.metadata).toEqual({
      notes: "Edited in Pond",
      tags: ["pond-only"],
    });
  });

  it("rejects a cards.csv that is not a mymind export", async () => {
    const directory = join(root, "invalid");
    await mkdir(directory);
    await writeFile(
      join(directory, "cards.csv"),
      "name,email\nAda,ada@example.com",
    );

    await expect(
      importMymindExport(directory, createImportFixture().dependencies),
    ).resolves.toEqual({
      ok: false,
      error: "Couldn't import cards.csv: the file isn't a mymind export",
    });
  });

  it("reports a metadata write failure instead of claiming success", async () => {
    const fixture = createImportFixture();
    fixture.dependencies.persistLinkMetadata = async () => false;

    await expect(
      importMymindExport(exportDirectory, fixture.dependencies),
    ).resolves.toEqual({
      ok: false,
      error:
        "Couldn't import An article, with a comma: its notes or dates couldn't be saved",
    });
  });
});
