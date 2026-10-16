import { z } from "zod";
import { CaptureWebDraftSchema } from "./capture";
import { enqueueRequestSchema } from "./ingest";
import { extensionCookieSchema, sessionImportPayloadSchema } from "./session";

export const NATIVE_HOST_NAME = "so.pond.host";

/** Pinned by `manifest.key` in the extension; native-host `allowed_origins` must match. */
export const EXTENSION_ID = "ihciihlcdkopghlpabpmnodncfdboplb";

/** Firefox rejects `manifest.key`, so the gecko id is pinned here for `allowed_extensions`. */
export const FIREFOX_EXTENSION_ID = "desktop@pond.so";

export const nativeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({
    type: z.literal("capture.accept"),
    draft: CaptureWebDraftSchema,
    cookies: z.array(extensionCookieSchema).max(500).optional(),
  }),
  z.object({ type: z.literal("library.info") }),
  z.object({ type: z.literal("folders.list") }),
  z.object({ type: z.literal("session.pending") }),
  enqueueRequestSchema.extend({ type: z.literal("enqueue") }),
  sessionImportPayloadSchema.extend({ type: z.literal("session.import") }),
]);

export type NativeRequest = z.infer<typeof nativeRequestSchema>;

export const nativeSuccessSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

export const nativeErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

export const nativeResponseSchema = z.union([
  nativeSuccessSchema,
  nativeErrorSchema,
]);

export type NativeResponse = z.infer<typeof nativeResponseSchema>;

export type NativeMessage = NativeRequest | NativeResponse;
