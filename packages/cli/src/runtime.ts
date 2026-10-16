import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function ready(baseUrl: string, timeout: number): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/app/info`, {
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function pondLaunchCommand(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "darwin")
    return { file: "open", args: ["-gj", "-a", "Pond"] };
  if (platform === "win32")
    return env.LOCALAPPDATA
      ? {
          file: join(env.LOCALAPPDATA, "Programs", "Pond", "Pond.exe"),
          args: [],
        }
      : { file: "explorer.exe", args: ["pond://library"] };
  return { file: "gtk-launch", args: ["pond"] };
}

function launchPond(): void {
  const command = pondLaunchCommand();
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  // A missing executable surfaces as the readiness timeout below.
  child.on("error", () => {});
  child.unref();
}

export async function ensurePondAvailable(
  baseUrl: string,
  timeout: number,
): Promise<void> {
  if (await ready(baseUrl, Math.min(timeout, 750))) return;
  launchPond();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await delay(250);
    if (await ready(baseUrl, Math.min(750, deadline - Date.now()))) return;
  }
  throw new Error(
    "Pond did not start before the timeout. Open the app and try again.",
  );
}
