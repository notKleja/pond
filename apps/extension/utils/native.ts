import {
  NATIVE_HOST_NAME,
  type NativeRequest,
  type NativeResponse,
  nativeResponseSchema,
} from "@pond/schema/native";

export async function nativeCall(
  request: NativeRequest,
): Promise<NativeResponse> {
  try {
    const response = await browser.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      request,
    );
    const parsed = nativeResponseSchema.safeParse(response);
    return parsed.success ? parsed.data : { ok: false, error: "offline" };
  } catch {
    return { ok: false, error: "offline" };
  }
}
