import type { LanguageModel } from "ai";

export const OPENCODE_GO_MODELS_BASE_URL =
  "https://opencode.ai/inference/go/v1";

const OPENCODE_GO_INFERENCE_BASE_URL = "https://opencode.ai/inference/go";
const OPENCODE_GO_USER_AGENT = "pond-desktop/1";

function requestHeaders(sessionId: string) {
  return {
    "user-agent": OPENCODE_GO_USER_AGENT,
    "x-opencode-session": sessionId,
  };
}

function usesOpenAIResponses(modelId: string): boolean {
  return /^(grok-|gpt-|muse-spark-)/.test(modelId);
}

function usesAnthropicMessages(modelId: string): boolean {
  return /^(claude-|minimax-|qwen)/.test(modelId);
}

function usesGoogleGenerateContent(modelId: string): boolean {
  return modelId.startsWith("gemini-");
}

export async function createOpenCodeGoModel(
  apiKey: string,
  modelId: string,
  sessionId: string,
  fetcher?: typeof fetch,
): Promise<LanguageModel> {
  const headers = requestHeaders(sessionId);
  if (usesOpenAIResponses(modelId)) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({
      name: "opencode-go",
      apiKey,
      baseURL: `${OPENCODE_GO_INFERENCE_BASE_URL}/openai/v1`,
      headers,
      fetch: fetcher,
    }).responses(modelId);
  }
  if (usesAnthropicMessages(modelId)) {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({
      name: "opencode-go",
      apiKey,
      baseURL: `${OPENCODE_GO_INFERENCE_BASE_URL}/anthropic/v1`,
      headers,
      fetch: fetcher,
    })(modelId);
  }
  if (usesGoogleGenerateContent(modelId)) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({
      name: "opencode-go",
      apiKey,
      baseURL: `${OPENCODE_GO_INFERENCE_BASE_URL}/google/v1beta`,
      headers,
      fetch: fetcher,
    })(modelId);
  }
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  return createOpenAICompatible({
    name: "opencode-go",
    apiKey,
    baseURL: `${OPENCODE_GO_INFERENCE_BASE_URL}/openai/v1`,
    headers,
    fetch: fetcher,
  })(modelId);
}
