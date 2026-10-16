import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cmdShimInvocation, pathEnvKey, quoteCmdArg } from "./cli-runtime";

describe("pathEnvKey", () => {
  it("finds the PATH variable whatever its casing", () => {
    expect(pathEnvKey({ Path: "C:\bin", HOME: "x" })).toBe("Path");
    expect(pathEnvKey({ PATH: "/bin" })).toBe("PATH");
  });

  it("defaults to PATH when none is set", () => {
    expect(pathEnvKey({ HOME: "x" })).toBe("PATH");
  });
});

describe("quoteCmdArg", () => {
  it.each([
    "100%",
    "%PATH%",
    "hello!",
    "two\nlines",
    "carriage\rreturn",
    "nul\0",
  ])("rejects %j, which cmd.exe would still interpret", (arg) => {
    expect(() => quoteCmdArg(arg)).toThrow(/cannot pass safely/);
  });

  it("wraps a plain argument in an escaped pair of quotes", () => {
    expect(quoteCmdArg("--print", 1)).toBe('^"--print^"');
  });
});

describe.skipIf(process.platform !== "win32")("cmd shims on windows", () => {
  it("passes arguments to a .cmd shim verbatim without running them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pond cli shim-"));
    try {
      const marker = join(directory, "injected");
      await writeFile(
        join(directory, "echo-args.js"),
        "console.log(JSON.stringify(process.argv.slice(2)))",
      );
      await writeFile(
        join(directory, "echo-args.cmd"),
        `@"${process.execPath}" "%~dp0echo-args.js" %*\r\n`,
      );
      const args = [
        "--print",
        '{"type":"object"}',
        `x" & echo pwned > "${marker}" & "`,
        "a|b <c> (d) ^e",
        "backslash\\",
        "with space",
      ];
      const { file, args: cmdArgs } = cmdShimInvocation(
        join(directory, "echo-args.cmd"),
        args,
      );
      const result = spawnSync(file, cmdArgs, {
        encoding: "utf8",
        windowsVerbatimArguments: true,
        windowsHide: true,
      });
      expect(JSON.parse(result.stdout)).toEqual(args);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
