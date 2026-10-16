import { describe, expect, it } from "vitest";
import { buildTweetCardData } from "./tweet-card";

describe("buildTweetCardData", () => {
  it("drops blob: video posters so the native card does not paint a dead tile", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      media: [
        {
          url: "blob:https://x.com/poster",
          type: "video",
          posterUrl: "blob:https://x.com/poster",
          durationSec: 10,
          width: 1280,
          height: 720,
        },
      ],
    });
    expect(data?.media).toEqual([
      {
        url: "blob:https://x.com/poster",
        type: "video",
        durationSec: 10,
        width: 1280,
        height: 720,
      },
    ]);
  });

  it("drops t.co wrappers from tweet text", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      description:
        "As a developer with OCPD, this really pisses me off. https://t.co/8BzuJIWrdT",
      media: [],
    });
    expect(data?.text).toBe(
      "As a developer with OCPD, this really pisses me off.",
    );
  });

  it("omits tweet text that is only a t.co wrapper", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      description: "https://t.co/8BzuJIWrdT",
      media: [],
      card: { url: "https://example.com/article", title: "Article" },
    });
    expect(data?.text).toBeUndefined();
    expect(data?.card?.title).toBe("Article");
  });

  it("drops t.co wrappers from quoted tweet text", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      description: "quoting this",
      media: [],
      quoted: {
        id: "2",
        source: "twitter",
        url: "https://x.com/b/status/2",
        description: "original thought https://t.co/abcDEF",
        media: [],
      },
    });
    expect(data?.quoted?.text).toBe("original thought");
  });

  it("keeps the parent post on a reply card", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      description: "this reply",
      isReply: true,
      replyingTo: "bob",
      media: [],
      replyTo: {
        id: "2",
        source: "twitter",
        url: "https://x.com/bob/status/2",
        description: "the original point",
        author: { handle: "bob", name: "Bob" },
        media: [],
      },
    });
    expect(data?.isReply).toBe(true);
    expect(data?.replyTo?.text).toBe("the original point");
    expect(data?.replyTo?.author.handle).toBe("bob");
  });

  it("keeps http video posters", () => {
    const data = buildTweetCardData({
      id: "1",
      source: "twitter",
      url: "https://x.com/a/status/1",
      media: [
        {
          url: "https://video.twimg.com/clip.mp4",
          type: "video",
          posterUrl: "https://pbs.twimg.com/thumb.jpg",
        },
      ],
    });
    expect(data?.media?.[0]).toMatchObject({
      type: "video",
      posterUrl: "https://pbs.twimg.com/thumb.jpg",
    });
  });
});
