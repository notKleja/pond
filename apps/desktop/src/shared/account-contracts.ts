import type { ConnectedAccount } from "@pond/schema/db";
import type { EmptyInput, OkResult } from "./query-contracts-shared";

export interface AccountQueryInputs {
  "accounts.list": EmptyInput;
  "accounts.setHandle": { accountId: string; handle: string | null };
  "accounts.setLabel": { accountId: string; label: string | null };
  "accounts.setSyncLikes": { accountId: string; syncLikes: boolean };
  "accounts.disconnect": { accountId: string };
}

export interface AccountQueryResults {
  "accounts.list": {
    accounts: (ConnectedAccount & { connected: boolean; syncing: boolean })[];
  };
  "accounts.setHandle": OkResult<{ account: ConnectedAccount }>;
  "accounts.setLabel": OkResult<{ account: ConnectedAccount }>;
  "accounts.setSyncLikes": OkResult;
  "accounts.disconnect": OkResult;
}
