/**
 * OpenRouter service wrapper (thin shim).
 *
 * OpenRouter exposes an OpenAI-compatible HTTP API at
 * `https://openrouter.ai/api/v1`. Rather than build our own HTTP client we
 * point the official `openai` SDK at OpenRouter's base URL — every method on
 * `client.chat.completions`, `client.completions`, `client.embeddings`, and
 * `client.models` works unmodified, and we get the OpenAI SDK's rich typed
 * error hierarchy for free.
 *
 * Required env vars:
 *   - OPENROUTER_API_KEY
 * Optional env vars:
 *   - OPENROUTER_DEFAULT_MODEL  (used by chat() when no model is supplied;
 *                                defaults to "openai/gpt-4o-mini")
 *   - OPENROUTER_HTTP_REFERER   (sent as the HTTP-Referer header — required
 *                                by OpenRouter to attribute traffic to your app)
 *   - OPENROUTER_X_TITLE        (sent as the X-Title header)
 *
 * Usage:
 *   import { openrouter } from "@/lib/services/openrouter";
 *   const reply = await openrouter.chat({
 *     messages: [{ role: "user", content: "hello" }],
 *   });
 *   // reply.choices[0].message.content
 */

import OpenAI, {
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  NotFoundError,
  type ClientOptions,
} from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "openrouter";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function normalizeError(err: unknown): never {
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (err instanceof RateLimitError) {
    // OpenAI SDK exposes headers as a Web Headers object on err.headers.
    const headers = (err as unknown as { headers?: Headers | Record<string, string | undefined> }).headers;
    let retryHeader: string | null | undefined;
    if (headers && typeof (headers as Headers).get === "function") {
      retryHeader = (headers as Headers).get("retry-after");
    } else if (headers && typeof headers === "object") {
      retryHeader = (headers as Record<string, string | undefined>)["retry-after"];
    }
    const retryAfter = retryHeader ? parseInt(retryHeader, 10) || undefined : undefined;
    throw new ServiceRateLimitError(PROVIDER, retryAfter, err);
  }
  if (err instanceof NotFoundError) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  // Some non-typed errors still carry status
  const e = err as { status?: number } | null;
  if (e && typeof e === "object") {
    if (e.status === 401 || e.status === 403) {
      throw new ServiceAuthError(PROVIDER, err);
    }
    if (e.status === 429) {
      throw new ServiceRateLimitError(PROVIDER, undefined, err);
    }
    if (e.status === 404) {
      throw new ServiceNotFoundError(PROVIDER, undefined, err);
    }
  }
  throw err;
}

export class OpenRouterService {
  private _client: OpenAI | null = null;

  /** Underlying OpenAI client pointed at OpenRouter. */
  get client(): OpenAI {
    if (!this._client) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: OPENROUTER_API_KEY"),
        );
      }
      const defaultHeaders: Record<string, string> = {};
      if (process.env.OPENROUTER_HTTP_REFERER) {
        defaultHeaders["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
      }
      if (process.env.OPENROUTER_X_TITLE) {
        defaultHeaders["X-Title"] = process.env.OPENROUTER_X_TITLE;
      }

      const opts: ClientOptions = {
        apiKey,
        baseURL: DEFAULT_BASE_URL,
        defaultHeaders: Object.keys(defaultHeaders).length ? defaultHeaders : undefined,
      };
      this._client = new OpenAI(opts);
    }
    return this._client;
  }

  /**
   * Run an arbitrary OpenAI-SDK call against OpenRouter and normalize errors.
   *
   * @example
   *   const models = await openrouter.run((c) => c.models.list());
   */
  async run<T>(fn: (client: OpenAI) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Convenience: send a chat completion request. Defaults the `model` field
   * to `OPENROUTER_DEFAULT_MODEL` (or `openai/gpt-4o-mini`) if not provided.
   * Returns the full ChatCompletion response.
   */
  async chat(
    params: Omit<ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string },
  ): Promise<ChatCompletion> {
    const model = params.model ?? process.env.OPENROUTER_DEFAULT_MODEL ?? DEFAULT_MODEL;
    const finalParams = { ...params, model } as ChatCompletionCreateParamsNonStreaming;
    return this.run((c) => c.chat.completions.create(finalParams));
  }

  /**
   * Convenience: extract just the assistant text from a chat completion.
   * Returns an empty string if the response has no content.
   */
  async chatText(
    params: Omit<ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string },
  ): Promise<string> {
    const completion = await this.chat(params);
    return completion.choices[0]?.message?.content ?? "";
  }

  /** List the models OpenRouter exposes for the current API key. */
  async listModels() {
    return this.run((c) => c.models.list());
  }
}

export const openrouter = new OpenRouterService();
export default openrouter;
export { OpenAI };
export type { ChatCompletion, ChatCompletionCreateParamsNonStreaming };
