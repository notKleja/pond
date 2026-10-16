import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  baseUrl: z.string().optional(),
  token: z.string().optional(),
  timeout: z.number().int().positive().optional(),
});

export type PondCliConfig = z.infer<typeof ConfigSchema>;

export function configPath(
  env = process.env,
  platform = process.platform,
): string {
  if (env.POND_CONFIG) return env.POND_CONFIG;
  if (platform === "win32")
    return join(
      env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "Pond",
      "cli.json",
    );
  if (platform === "darwin")
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Pond",
      "cli.json",
    );
  return join(
    env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "pond",
    "cli.json",
  );
}

export async function readConfig(path = configPath()): Promise<PondCliConfig> {
  try {
    return ConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    throw error;
  }
}

export async function writeConfig(
  config: PondCliConfig,
  path = configPath(),
): Promise<void> {
  const parsed = ConfigSchema.parse(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export async function resolvedConfig(overrides: {
  baseUrl?: string;
  token?: string;
  timeout?: number;
}): Promise<Required<PondCliConfig>> {
  const stored = await readConfig();
  return {
    baseUrl:
      overrides.baseUrl ??
      process.env.POND_BASE_URL ??
      stored.baseUrl ??
      "http://127.0.0.1:41610/api/v2",
    token: overrides.token ?? process.env.POND_TOKEN ?? stored.token ?? "",
    timeout: overrides.timeout ?? stored.timeout ?? 15_000,
  };
}
