import { expect, it } from "vitest";
import { TerminalError } from "../extractors/errors";
import { requireFetchedMedia } from "./fetch-blobs";

it("fails the task when every captured media URL is permanently unavailable", () => {
  const mediaUrl =
    "https://i.pinimg.com/originals/96/1a/da/961adaf7db83e6d449a67674731c29d5.jpg";

  expect(() =>
    requireFetchedMedia([{ url: mediaUrl, file: null, miss: "permanent" }], 1),
  ).toThrow(TerminalError);
});
