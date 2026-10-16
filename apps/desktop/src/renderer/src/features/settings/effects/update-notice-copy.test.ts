import { describe, expect, it } from "vitest";
import { updateNoticeCopy } from "./update-notice-copy";

describe("updateNoticeCopy", () => {
  it("says a build is downloading when automatic updates are on", () => {
    expect(
      updateNoticeCopy({
        phase: "available",
        version: "1.0.2",
        downloading: true,
      }),
    ).toEqual({
      title: "Update available",
      description: "Pond 1.0.2 is downloading.",
    });
  });

  it("offers Download when the build is not downloading yet", () => {
    expect(
      updateNoticeCopy({
        phase: "available",
        version: "1.0.2",
        downloading: false,
      }),
    ).toEqual({
      title: "Update available",
      description: "Pond 1.0.2 is ready to download.",
      action: "Download",
    });
  });

  it("offers Restart after the download finishes", () => {
    expect(updateNoticeCopy({ phase: "downloaded", version: "1.0.2" })).toEqual(
      {
        title: "Update ready",
        description: "Restart to finish installing Pond 1.0.2.",
        action: "Restart",
      },
    );
  });
});
