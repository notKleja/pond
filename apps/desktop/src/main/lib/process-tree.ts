import { type ChildProcess, spawn } from "node:child_process";

type KillableProcess = Pick<ChildProcess, "pid" | "kill">;

type ProcessTreeKillDeps = {
  platform?: NodeJS.Platform;
  spawnTaskkill?: (args: string[]) => void;
};

function spawnTaskkill(args: string[]) {
  const taskkill = spawn("taskkill", args, {
    windowsHide: true,
    stdio: "ignore",
  });
  taskkill.on("error", () => {
    /* taskkill is missing or the tree already exited. */
  });
}

/**
 * Windows has no process groups or signals: child.kill() only ends the direct
 * child, so `taskkill /T` is needed to also end processes it started.
 */
export function killProcessTree(
  child: KillableProcess,
  signal: NodeJS.Signals,
  deps: ProcessTreeKillDeps = {},
) {
  const { platform = process.platform, spawnTaskkill: run = spawnTaskkill } =
    deps;
  if (platform === "win32" && child.pid) {
    try {
      run(["/pid", String(child.pid), "/T", "/F"]);
    } catch {
      /* The process may already have exited. */
    }
    return;
  }
  child.kill(signal);
}
