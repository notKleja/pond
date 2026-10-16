import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderThumbnail } from "./save-thumbnail-file";

describe("renderThumbnail", () => {
  it("encodes a resized thumbnail as WebP", async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: "#336699",
      },
    })
      .jpeg()
      .toBuffer();
    const thumbnail = await renderThumbnail(source);
    expect(thumbnail).not.toBeNull();
    if (!thumbnail) return;
    const meta = await sharp(thumbnail).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
  });
});
