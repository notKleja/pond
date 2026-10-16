import { z } from "zod";
import type { OkFailure } from "../../../shared/query-contracts-shared";
import { isAccountConnected } from "../../core/refresh/harvest-window";
import { isSyncing } from "../../core/sync";
import {
  getAccount,
  listAccounts,
  patchAccount,
  patchAccountSync,
  removeAccount,
} from "../../core/sync/accounts";
import { fillMissingAvatars } from "../../core/sync/avatars";
import { countSavesForAccount } from "../../core/sync/sync-baseline";
import {
  type QueryHandlerMap,
  query,
  StringParam,
  TrimmedTextParam,
} from "./params";

const ACCOUNT_NOT_FOUND: OkFailure = { ok: false, error: "Account not found." };
const SYNC_LIKES_UNSUPPORTED: OkFailure = {
  ok: false,
  error: "Syncing Likes is only available for X accounts.",
};

interface SetSyncLikesDependencies {
  getAccount: typeof getAccount;
  patchAccountSync: typeof patchAccountSync;
}

export function createSetSyncLikesQuery(
  dependencies: SetSyncLikesDependencies = { getAccount, patchAccountSync },
) {
  return query(
    z.strictObject({
      accountId: z.string().trim().min(1),
      syncLikes: z.boolean(),
    }),
    async (params) => {
      const account = await dependencies.getAccount(params.accountId);
      if (!account) return ACCOUNT_NOT_FOUND;
      if (account.source !== "twitter") return SYNC_LIKES_UNSUPPORTED;
      await dependencies.patchAccountSync(params.accountId, {
        syncLikes: params.syncLikes,
      });
      return { ok: true as const };
    },
  );
}

export const accountsQueries = {
  async "accounts.list"() {
    fillMissingAvatars();
    const accounts = await listAccounts();
    const rows = await Promise.all(
      accounts.map(async (account) => {
        const knownCount = await countSavesForAccount(account).catch(
          () => account.sync.knownCount,
        );
        return {
          ...account,
          sync: { ...account.sync, knownCount },
          connected: await isAccountConnected(account).catch(() => false),
          syncing: isSyncing(account.id),
        };
      }),
    );
    return { accounts: rows };
  },

  "accounts.setHandle": query(
    z.object({ accountId: StringParam, handle: TrimmedTextParam }),
    async (params) => {
      const account = await patchAccount(params.accountId, {
        handle: params.handle,
        avatarUrl: null,
        avatarCheckedAt: null,
      });
      if (!account) return ACCOUNT_NOT_FOUND;
      fillMissingAvatars();
      return { ok: true as const, account };
    },
  ),

  "accounts.setLabel": query(
    z.object({ accountId: StringParam, label: TrimmedTextParam }),
    async (params) => {
      const account = await patchAccount(params.accountId, {
        label: params.label,
      });
      return account ? { ok: true as const, account } : ACCOUNT_NOT_FOUND;
    },
  ),

  "accounts.setSyncLikes": createSetSyncLikesQuery(),

  "accounts.disconnect": query(
    z.object({ accountId: StringParam }),
    async (params) => {
      const account = await getAccount(params.accountId);
      if (!account) return ACCOUNT_NOT_FOUND;
      await removeAccount(params.accountId);
      return { ok: true as const };
    },
  ),
} satisfies QueryHandlerMap;
