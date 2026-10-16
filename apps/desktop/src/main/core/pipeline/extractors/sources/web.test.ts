import { expect, it, vi } from "vitest";
import { WebPageExtractor } from "./web";

const fetchedHtml = "<html><head><title>Fetched page</title></head></html>";
const renderedHtml = "<html><head><title>Rendered page</title></head></html>";

it("uses a browser render when the direct fetch reaches a bot wall", async () => {
  const fetchHtml = vi.fn().mockResolvedValue(null);
  const renderHtml = vi.fn().mockResolvedValue(renderedHtml);
  const extractor = new WebPageExtractor({ fetchHtml, renderHtml });

  await expect(
    extractor.extract({ url: new URL("https://example.com/article") }),
  ).resolves.toMatchObject({ title: "Rendered page" });
  expect(renderHtml).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/article",
    undefined,
  );
});

it("does not acquire a browser when the direct fetch succeeds", async () => {
  const renderHtml = vi.fn().mockResolvedValue(renderedHtml);
  const extractor = new WebPageExtractor({
    fetchHtml: vi.fn().mockResolvedValue(fetchedHtml),
    renderHtml,
  });

  await expect(
    extractor.extract({ url: new URL("https://example.com/article") }),
  ).resolves.toMatchObject({ title: "Fetched page" });
  expect(renderHtml).not.toHaveBeenCalled();
});
