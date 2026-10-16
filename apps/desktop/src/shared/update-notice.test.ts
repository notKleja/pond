import { describe, expect, it } from "vitest";
import { UpdateNoticeSchema } from "./update-notice";

describe("UpdateNoticeSchema", () => {
  it("accepts valid phase-specific payloads", () => {
    expect(
      UpdateNoticeSchema.parse({
        phase: "available",
        version: "1.0.2",
        downloading: true,
      }),
    ).toEqual({
      phase: "available",
      version: "1.0.2",
      downloading: true,
    });
    expect(
      UpdateNoticeSchema.parse({ phase: "downloaded", version: "1.0.2" }),
    ).toEqual({ phase: "downloaded", version: "1.0.2" });
  });

  it("rejects impossible phase data", () => {
    expect(() =>
      UpdateNoticeSchema.parse({ phase: "available", version: "1.0.2" }),
    ).toThrow();
    expect(() =>
      UpdateNoticeSchema.parse({
        phase: "downloaded",
        version: "1.0.2",
        downloading: true,
      }),
    ).toThrow();
  });
});
