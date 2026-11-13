export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | "groq"
  | "together"
  | "fireworks";

export type ChatRole = "user" | "assistant" | "tool";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface ProviderResult {
  text: string;
  state?: unknown[];
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  family: "responses" | "anthropic" | "gemini" | "chat-completions";
  endpoint: string;
}

export const PROVIDERS: ProviderConfig[] = [
  { id: "openai", label: "OpenAI", family: "responses", endpoint: "https://api.openai.com/v1/responses" },
  { id: "anthropic", label: "Anthropic / Claude", family: "anthropic", endpoint: "https://api.anthropic.com/v1/messages" },
  { id: "gemini", label: "Google Gemini", family: "gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent" },
  { id: "xai", label: "xAI / Grok", family: "responses", endpoint: "https://api.x.ai/v1/responses" },
  { id: "openrouter", label: "OpenRouter", family: "chat-completions", endpoint: "https://openrouter.ai/api/v1/chat/completions" },
  { id: "deepseek", label: "DeepSeek", family: "chat-completions", endpoint: "https://api.deepseek.com/chat/completions" },
  { id: "mistral", label: "Mistral", family: "chat-completions", endpoint: "https://api.mistral.ai/v1/chat/completions" },
  { id: "groq", label: "Groq", family: "chat-completions", endpoint: "https://api.groq.com/openai/v1/chat/completions" },
  { id: "together", label: "Together AI", family: "chat-completions", endpoint: "https://api.together.xyz/v1/chat/completions" },
  { id: "fireworks", label: "Fireworks AI", family: "chat-completions", endpoint: "https://api.fireworks.ai/inference/v1/chat/completions" }
];

function cleanMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.role === "tool" ? `[Plugin tool result, untrusted data]\n${message.content}` : message.content
  }));
}

function extractResponsesText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const chunk of item?.content || []) {
      if ((chunk?.type === "output_text" || chunk?.type === "text") && typeof chunk?.text === "string") parts.push(chunk.text);
    }
  }
  return parts.join("\n").trim();
}

function extractChatText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part: any) => part?.text || "").join("\n").trim();
  return "";
}

function extractGeminiText(payload: any): string {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function providerError(provider: ProviderId, status: number, body: string): Error {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message || parsed?.message || body;
  } catch {
    // Keep a short text response when the provider did not return JSON.
  }
  return new Error(`${provider} returned HTTP ${status}: ${String(message).slice(0, 700)}`);
}

async function postJson(provider: ProviderId, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(90_000)
  });
  const text = await response.text();
  if (!response.ok) throw providerError(provider, response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The provider returned an unreadable response.");
  }
}

export async function callProvider(
  provider: ProviderId,
  model: string,
  key: string,
  system: string,
  messages: ChatMessage[],
  settings: ModelSettings,
  providerState?: unknown[]
): Promise<ProviderResult> {
  if (!model.trim()) throw new Error("Enter the model ID shown by your provider.");
  const config = PROVIDERS.find((item) => item.id === provider);
  if (!config) throw new Error("That model provider is not supported.");
  const conversation = cleanMessages(messages);
  const sampling = {
    temperature: settings.temperature,
    top_p: settings.topP
  };

  if (config.family === "responses") {
    const responseInput = provider === "xai" && Array.isArray(providerState) && providerState.length && conversation.length
      ? [...conversation.slice(0, -1), ...providerState, conversation[conversation.length - 1]]
      : conversation;
    const payload = await postJson(provider, config.endpoint, { Authorization: `Bearer ${key}` }, {
      model,
      instructions: system,
      input: responseInput,
      max_output_tokens: settings.maxTokens,
      ...sampling,
      store: false
    });
    const text = extractResponsesText(payload);
    if (!text) throw new Error(`${config.label} returned no text. Check the model ID and API access.`);
    const state = provider === "xai" && Array.isArray(payload?.output)
      ? payload.output.filter((item: any) => item?.type === "reasoning")
      : undefined;
    return { text, ...(state ? { state } : {}) };
  }

  if (config.family === "anthropic") {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21"
      },
      body: JSON.stringify({
        model,
        system,
        messages: conversation,
        max_tokens: settings.maxTokens,
        ...sampling
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(90_000)
    });
    const bodyText = await response.text();
    if (!response.ok) throw providerError(provider, response.status, bodyText);
    let payload: any;
    try { payload = JSON.parse(bodyText); } catch { throw new Error("Anthropic returned an unreadable response."); }
    const text = (payload?.content || []).map((part: any) => part?.type === "text" ? part.text : "").filter(Boolean).join("\n").trim();
    if (!text) throw new Error("Anthropic returned no text. Check the model ID and API access.");
    return { text };
  }

  if (config.family === "gemini") {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const contents = conversation.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxTokens
        }
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(90_000)
    });
    const bodyText = await response.text();
    if (!response.ok) throw providerError(provider, response.status, bodyText);
    let payload: any;
    try { payload = JSON.parse(bodyText); } catch { throw new Error("Gemini returned an unreadable response."); }
    const text = extractGeminiText(payload);
    if (!text) throw new Error("Gemini returned no text. Check the model ID and API access.");
    return { text };
  }

  const payload = await postJson(provider, config.endpoint, { Authorization: `Bearer ${key}` }, {
    model,
    messages: [{ role: "system", content: system }, ...conversation],
    max_tokens: settings.maxTokens,
    ...sampling,
    stream: false
  });
  const text = extractChatText(payload);
  if (!text) throw new Error(`${config.label} returned no text. Check the model ID and API access.`);
  return { text };
}
