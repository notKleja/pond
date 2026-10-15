import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const WINDOWS_SID = /^S-\d+(?:-\d+)+$/;

export function parseWindowsUserSid(output: string): string {
  const match = /,"(S-\d+(?:-\d+)+)"\s*$/.exec(output.trim());
  const sid = match?.[1];
  if (!sid || !WINDOWS_SID.test(sid)) {
    throw new Error("Could not resolve the current Windows user SID.");
  }
  return sid;
}

function resolveWindowsUserSid(): string {
  return parseWindowsUserSid(
    execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
}

export function windowsNativePipePath(sid: string): string {
  if (!WINDOWS_SID.test(sid)) throw new Error("Invalid Windows user SID.");
  return `\\\\.\\pipe\\pond-native-host-${sid}`;
}

/** Chrome native-host connect path; keep in lockstep with `pond-native-host.c`. */
export function nativeSocketPath(
  platform: NodeJS.Platform = process.platform,
  sidResolver: () => string = resolveWindowsUserSid,
): string {
  if (platform === "win32") return windowsNativePipePath(sidResolver());
  if (process.env.POND_SANDBOX) {
    return join(process.env.POND_SANDBOX, "native.sock");
  }
  return join(homedir(), "Library/Application Support/Pond", "native.sock");
}
