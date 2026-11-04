import { RefusalError } from "./client.js";

export interface ChatRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  /** Ask for JSON matching this schema (OpenAI-style structured outputs). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  error?: { message?: string } | string;
}

/**
 * One chat completion against any OpenAI-compatible API: OpenAI, Gemini's
 * compatibility endpoint, Ollama, LM Studio, Groq, Mistral and similar.
 */
export async function chatCompletion(req: ChatRequest): Promise<string> {
  const res = await fetch(`${req.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { ...req.jsonSchema, strict: true } } }
        : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const body = (await res.json().catch(() => ({}))) as ChatResponse;
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`${req.model}: ${message ?? `HTTP ${res.status}`}`);
  }
  const message = body.choices?.[0]?.message;
  if (message?.refusal) throw new RefusalError(null);
  if (!message?.content) throw new Error(`${req.model} returned an empty response`);
  return message.content;
}
