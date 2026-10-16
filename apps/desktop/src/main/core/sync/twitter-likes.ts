import type { ConnectedAccount } from "@pond/schema/db";
import type {
  BookmarksHarvestArgs,
  BookmarksHarvestResult,
} from "../refresh/harvest/twitter";

export function shouldHarvestTwitterLikes(
  account: { handle: string | null; sync: { syncLikes?: boolean } },
  aborted: boolean,
): boolean {
  const handle = account.handle?.replace(/^@/, "").trim();
  return account.sync.syncLikes !== false && !aborted && Boolean(handle);
}

interface TwitterLikesDependencies {
  harvestTwitterLikes: (
    args: BookmarksHarvestArgs,
    options: { partition: string; handle: string },
  ) => Promise<BookmarksHarvestResult>;
}

export async function harvestConfiguredTwitterLikes(
  account: ConnectedAccount,
  input: {
    aborted: boolean;
    knownIds: string[];
    partition: string;
  },
  dependencies: TwitterLikesDependencies,
): Promise<BookmarksHarvestResult | null> {
  if (account.sync.syncLikes === false) return null;
  if (!shouldHarvestTwitterLikes(account, input.aborted)) {
    return { ok: false, reason: "no_match" };
  }
  return dependencies.harvestTwitterLikes(
    { knownIds: input.knownIds },
    {
      partition: input.partition,
      handle: account.handle?.replace(/^@/, "").trim() ?? "",
    },
  );
}
