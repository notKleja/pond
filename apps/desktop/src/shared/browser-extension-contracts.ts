import { z } from "zod";
import type { OkResult } from "./query-contracts-shared";

export const ExtensionBrowserSchema = z.enum(["chrome", "firefox"]);
export type ExtensionBrowser = z.infer<typeof ExtensionBrowserSchema>;

export const BrowserExtensionInstallInputSchema = z.object({
  browser: ExtensionBrowserSchema.optional(),
});
type BrowserExtensionInstallInput = z.infer<
  typeof BrowserExtensionInstallInputSchema
>;

export interface BrowserExtensionQueryInputs {
  "extension.install": BrowserExtensionInstallInput;
}

export interface BrowserExtensionQueryResults {
  "extension.install": OkResult<{ path: string }>;
}
