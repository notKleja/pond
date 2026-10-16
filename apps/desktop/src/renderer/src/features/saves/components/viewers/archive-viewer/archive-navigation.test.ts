import { describe, expect, it } from "vitest";
import {
  currentPageIndex,
  displayArchiveAddress,
  initialPageHistory,
  stepPage,
  visitPage,
} from "./archive-navigation";

describe("archive page history", () => {
  it("supports back, forward, and replacement after going back", () => {
    const first = visitPage(visitPage(initialPageHistory(), 1), 2);
    const back = stepPage(first, -1);

    expect(currentPageIndex(back)).toBe(1);
    expect(currentPageIndex(stepPage(back, 1))).toBe(2);
    expect(visitPage(back, 3)).toEqual({ entries: [0, 1, 3], cursor: 2 });
  });

  it("does not step beyond the available history", () => {
    const history = initialPageHistory();
    expect(stepPage(history, -1)).toBe(history);
    expect(stepPage(history, 1)).toBe(history);
  });
});

it("formats archived page addresses without protocol or www", () => {
  expect(displayArchiveAddress("https://www.example.com/docs/?q=pond")).toBe(
    "example.com/docs?q=pond",
  );
});
