import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { killProcessTree } from "./process-tree";

function fakeChild(pid: number | undefined) {
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  const child: Pick<ChildProcess, "pid" | "kill"> = {
    pid,
    kill: (signal) => {
      signals.push(signal);
      return true;
    },
  };
  return { child, signals };
}

describe("killProcessTree", () => {
  it("kills the whole tree with taskkill on windows", () => {
    const { child, signals } = fakeChild(4321);
    const calls: string[][] = [];
    killProcessTree(child, "SIGKILL", {
      platform: "win32",
      spawnTaskkill: (args) => calls.push(args),
    });
    expect(calls).toEqual([["/pid", "4321", "/T", "/F"]]);
    expect(signals).toEqual([]);
  });

  it("signals the child directly on other platforms", () => {
    const { child, signals } = fakeChild(4321);
    const calls: string[][] = [];
    killProcessTree(child, "SIGTERM", {
      platform: "linux",
      spawnTaskkill: (args) => calls.push(args),
    });
    expect(calls).toEqual([]);
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("does not throw when taskkill cannot start", () => {
    const { child } = fakeChild(4321);
    expect(() =>
      killProcessTree(child, "SIGKILL", {
        platform: "win32",
        spawnTaskkill: () => {
          throw new Error("spawn failed");
        },
      }),
    ).not.toThrow();
  });
});
