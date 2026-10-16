import type { LanguageModel } from "ai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_KEY_URL = `${OPENROUTER_BASE_URL}/key`;
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models/user?output_modalities=text`;

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://github.com/raphaelsalaja/pond",
  "X-OpenRouter-Title": "Pond",
};

export async function createOpenRouterModel(
  apiKey: string,
  modelId: string,
  fetcher?: typeof fetch,
): Promise<LanguageModel> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({
    name: "openrouter",
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: OPENROUTER_HEADERS,
    fetch: fetcher,
  }).chat(modelId);
}
