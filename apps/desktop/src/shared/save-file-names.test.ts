import { describe, expect, it } from "vitest";
import {
  assignHarvestedFilenames,
  inferKindFromFilename,
  isThumbnailFilename,
  mediaFilename,
  pickCardFile,
  posterFilename,
  thumbnailFilename,
  videoFilename,
  webpThumbnailFilename,
} from "./save-file-names";

describe("harvested filenames", () => {
  it("numbers stills and videos from 1", () => {
    expect(mediaFilename(0, ".jpg")).toBe("media-1.jpg");
    expect(mediaFilename(1, ".jpg")).toBe("media-2.jpg");
    expect(videoFilename(0, ".mp4")).toBe("video-1.mp4");
    expect(posterFilename(0, ".jpg")).toBe("poster-1.jpg");
  });

  it("renumbers successful harvests without a cover slot", () => {
    expect(
      assignHarvestedFilenames([
        { filename: "cover.jpg" },
        { filename: "video.mp4" },
        null,
        { filename: "media-1.png" },
      ]),
    ).toEqual([
      { filename: "media-1.jpg" },
      { filename: "video-1.mp4" },
      null,
      { filename: "media-2.png" },
    ]);
  });
});

describe("thumbnail suffix", () => {
  it("appends _thumbnail.webp to the original basename", () => {
    expect(thumbnailFilename("layout.psd")).toBe("layout.psd_thumbnail.webp");
    expect(thumbnailFilename("media-1.jpg")).toBe("media-1.jpg_thumbnail.webp");
  });

  it("gives regenerated thumbnails a WebP extension", () => {
    expect(webpThumbnailFilename("image.png_thumbnail.png")).toBe(
      "image.png_thumbnail.webp",
    );
    expect(webpThumbnailFilename("thumbnail.png")).toBe("thumbnail.webp");
    expect(webpThumbnailFilename("preview")).toBe("preview.webp");
  });

  it("detects WebP, PNG, and text-card thumbnail names", () => {
    expect(isThumbnailFilename("layout.psd_thumbnail.webp")).toBe(true);
    expect(isThumbnailFilename("layout.psd_thumbnail.png")).toBe(true);
    expect(isThumbnailFilename("thumbnail.png")).toBe(true);
    expect(isThumbnailFilename("thumbnail.webp")).toBe(true);
    expect(isThumbnailFilename("thumbnail-dark.png")).toBe(true);
    expect(isThumbnailFilename("thumbnail-concept.psd")).toBe(false);
  });
});

describe("inferKindFromFilename", () => {
  it("maps new harvested names and thumbnail sidecars", () => {
    expect(inferKindFromFilename("media-1.jpg")).toBe("image");
    expect(inferKindFromFilename("video-1.mp4")).toBe("video");
    expect(inferKindFromFilename("poster-1.jpg")).toBe("poster");
    expect(inferKindFromFilename("media-1.jpg_thumbnail.webp")).toBe(
      "thumbnail",
    );
    expect(inferKindFromFilename("media-1.jpg_thumbnail.png")).toBe(
      "thumbnail",
    );
    expect(inferKindFromFilename("layout.psd_thumbnail.png")).toBe("thumbnail");
    expect(inferKindFromFilename("thumbnail-dark.png")).toBe("thumbnail_dark");
  });

  it("treats cover filenames as images", () => {
    expect(inferKindFromFilename("cover.jpg")).toBe("image");
  });
});

describe("pickCardFile", () => {
  it("prefers the thumbnail sidecar over originals", () => {
    expect(
      pickCardFile([
        { kind: "image", path: "media-1.jpg" },
        { kind: "thumbnail", path: "media-1.jpg_thumbnail.png" },
      ])?.path,
    ).toBe("media-1.jpg_thumbnail.png");
  });

  it("ignores text-card thumbnails when a poster exists", () => {
    expect(
      pickCardFile([
        { kind: "thumbnail", path: "thumbnail.png" },
        { kind: "thumbnail_dark", path: "thumbnail-dark.png" },
        { kind: "video", path: "video-1.mp4" },
        { kind: "poster", path: "poster-1.jpg" },
      ])?.path,
    ).toBe("poster-1.jpg");
  });
});
