import { describe, expect, it } from "vitest";
import {
  canDispatchTask,
  isInteractiveTask,
  isInteractiveTrigger,
  withInteractivePriority,
} from "./priority";

describe("isInteractiveTrigger", () => {
  it("treats pasted links, the extension, and intercepts as interactive", () => {
    expect(isInteractiveTrigger(undefined)).toBe(true);
    expect(isInteractiveTrigger("user:quickAdd")).toBe(true);
    expect(isInteractiveTrigger("toolbar")).toBe(true);
    expect(isInteractiveTrigger("action")).toBe(true);
    expect(isInteractiveTrigger("context-menu")).toBe(true);
    expect(isInteractiveTrigger("capture")).toBe(true);
    expect(isInteractiveTrigger("twitter:bookmark")).toBe(true);
    expect(isInteractiveTrigger("youtube:save")).toBe(true);
  });

  it("keeps sync, watches, and cron behind interactive work", () => {
    expect(isInteractiveTrigger("sync:twitter")).toBe(false);
    expect(isInteractiveTrigger("watch:youtube")).toBe(false);
    expect(isInteractiveTrigger("cron")).toBe(false);
    expect(isInteractiveTrigger("manual")).toBe(false);
    expect(isInteractiveTrigger("pipeline:enqueue")).toBe(false);
    expect(isInteractiveTrigger("enqueue:force")).toBe(false);
    expect(isInteractiveTrigger("user:importBookmarks")).toBe(false);
    expect(isInteractiveTrigger("user:importMymind")).toBe(false);
    expect(isInteractiveTrigger("user:importFiles")).toBe(false);
    expect(isInteractiveTrigger("user:importEagle")).toBe(false);
  });
});

describe("interactive task payload", () => {
  it("stamps priority without dropping harvest force", () => {
    expect(withInteractivePriority({ force: true })).toEqual({
      force: true,
      priority: "interactive",
    });
    expect(isInteractiveTask({ payload: withInteractivePriority() })).toBe(
      true,
    );
    expect(isInteractiveTask({ payload: { force: true } })).toBe(false);
    expect(isInteractiveTask({ payload: null })).toBe(false);
  });
});

describe("canDispatchTask", () => {
  const caps = {
    backgroundCap: 4,
    interactiveCap: 4,
    opCap: 2,
    paused: false,
  };

  it("starts a pasted link while background ingest is full or paused", () => {
    expect(
      canDispatchTask({
        ...caps,
        interactive: true,
        paused: true,
        inflightGlobal: 4,
        inflightInteractive: 0,
        inflightForOp: 2,
      }),
    ).toBe(true);
  });

  it("does not start more background work at the cap or while paused", () => {
    expect(
      canDispatchTask({
        ...caps,
        interactive: false,
        inflightGlobal: 4,
        inflightInteractive: 0,
        inflightForOp: 0,
      }),
    ).toBe(false);
    expect(
      canDispatchTask({
        ...caps,
        interactive: false,
        paused: true,
        inflightGlobal: 0,
        inflightInteractive: 0,
        inflightForOp: 0,
      }),
    ).toBe(false);
  });

  it("caps the interactive lane on its own", () => {
    expect(
      canDispatchTask({
        ...caps,
        interactive: true,
        inflightGlobal: 8,
        inflightInteractive: 3,
        inflightForOp: 0,
      }),
    ).toBe(true);
    expect(
      canDispatchTask({
        ...caps,
        interactive: true,
        inflightGlobal: 8,
        inflightInteractive: 4,
        inflightForOp: 0,
      }),
    ).toBe(false);
  });
});
