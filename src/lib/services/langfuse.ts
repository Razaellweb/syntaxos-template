/**
 * Langfuse service wrapper (thin shim).
 *
 * Langfuse is an open-source LLM engineering platform for observability,
 * prompt management, and evaluations. It uses OpenTelemetry under the hood
 * for trace ingestion — the `@langfuse/otel` package provides a
 * `LangfuseSpanProcessor` that plugs into the standard `@opentelemetry/sdk-node`
 * pipeline. The `@langfuse/client` package provides a REST client for
 * non-tracing features like prompt management and scoring.
 *
 * This wrapper owns three jobs:
 *   1. Initialising the OpenTelemetry NodeSDK with the LangfuseSpanProcessor
 *      (lazy, once, on first use).
 *   2. Exposing typed shortcuts for tracing (startTrace, startGeneration),
 *      prompt management, and scoring via the LangfuseClient.
 *   3. Normalising auth / not-found / rate-limit failures into the shared
 *      ServiceError family used by the rest of the template.
 *
 * Required env vars:
 *   - LANGFUSE_SECRET_KEY
 *   - LANGFUSE_PUBLIC_KEY
 * Optional env vars:
 *   - LANGFUSE_BASE_URL  (defaults to https://cloud.langfuse.com — EU region;
 *                         use https://us.cloud.langfuse.com for US)
 *
 * Usage:
 *   import { langfuse } from "@/lib/services/langfuse";
 *
 *   // Tracing
 *   await langfuse.trace("my-task", async (span) => {
 *     span.update({ input: "hello", output: "world" });
 *   });
 *
 *   // Prompt management
 *   const prompt = await langfuse.getPrompt("my-prompt");
 *   const compiled = prompt.compile({ name: "Alice" });
 *
 *   // Scoring
 *   await langfuse.createScore({
 *     traceId: "trace-123",
 *     name: "accuracy",
 *     value: 0.95,
 *   });
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { startActiveObservation } from "@langfuse/tracing";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "langfuse";
const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

// ── Public types ────────────────────────────────────────────────────────

export interface LangfuseCredentials {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
}

export interface CreateScoreParams {
  traceId?: string;
  sessionId?: string;
  observationId?: string;
  name: string;
  value: number | string | boolean;
  dataType?: "NUMERIC" | "CATEGORICAL" | "BOOLEAN" | "TEXT";
  comment?: string;
  id?: string;
  configId?: string;
}

export interface GetPromptOptions {
  type?: "text" | "chat";
  label?: string;
  version?: number;
}

export interface ObservationUpdate {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: "TOKENS" | "CHARACTERS" | "SECONDS" | "MILLISECONDS" | "IMAGES";
  };
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
}

// ── Error normalisation ─────────────────────────────────────────────────

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number; message?: string } | null;
  const status = e?.status ?? e?.statusCode;

  if (status === 401 || status === 403) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (status === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  if (status === 429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, err);
  }

  const message =
    e?.message ?? (typeof err === "string" ? err : "unknown error");
  throw new ServiceError(`[${PROVIDER}] ${message}`, PROVIDER, err);
}

// ── Implementation ──────────────────────────────────────────────────────

export class LangfuseService {
  private _sdk: NodeSDK | null = null;
  private _client: LangfuseClient | null = null;
  private _credentials: LangfuseCredentials | null = null;

  private getCredentials(): LangfuseCredentials {
    if (this._credentials) return this._credentials;

    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    if (!secretKey || !publicKey) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error(
          "missing required env vars: LANGFUSE_SECRET_KEY and/or LANGFUSE_PUBLIC_KEY",
        ),
      );
    }
    const baseUrl = (
      process.env.LANGFUSE_BASE_URL || DEFAULT_BASE_URL
    ).replace(/\/+$/, "");

    this._credentials = { secretKey, publicKey, baseUrl };
    return this._credentials;
  }

  /** Underlying LangfuseClient for prompts, scores, and datasets. */
  get client(): LangfuseClient {
    if (!this._client) {
      const { secretKey, publicKey, baseUrl } = this.getCredentials();
      this._client = new LangfuseClient({
        secretKey,
        publicKey,
        baseUrl,
      });
    }
    return this._client;
  }

  /**
   * Initialise the OpenTelemetry SDK with the LangfuseSpanProcessor.
   * Call once at application startup (idempotent — subsequent calls are no-ops).
   *
   * @example
   *   langfuse.initTracing();
   */
  initTracing(): NodeSDK {
    if (this._sdk) return this._sdk;

    this.getCredentials();
    this._sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    this._sdk.start();
    return this._sdk;
  }

  /**
   * Run an operation inside a traced observation. The tracing SDK must be
   * initialised first (via `initTracing()`). Errors thrown inside `fn` are
   * re-thrown after the span is ended.
   *
   * @example
   *   const result = await langfuse.trace("summarize", async (span) => {
   *     span.update({ input: doc, metadata: { userId: "u1" } });
   *     const summary = await llm.summarize(doc);
   *     span.update({ output: summary });
   *     return summary;
   *   });
   */
  async trace<T>(
    name: string,
    fn: (span: { update: (params: ObservationUpdate) => void }) => Promise<T>,
  ): Promise<T> {
    this.initTracing();
    try {
      return await startActiveObservation(name, fn as never) as T;
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Fetch a managed prompt by name. Returns a prompt object with a
   * `.compile(variables)` method for variable interpolation.
   *
   * @example
   *   const prompt = await langfuse.getPrompt("review-critic");
   *   const text = prompt.compile({ movie: "Dune 2" });
   */
  async getPrompt(name: string, options?: GetPromptOptions) {
    try {
      return await this.client.prompt.get(name, options);
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Create a score attached to a trace or observation.
   *
   * @example
   *   await langfuse.createScore({
   *     traceId: "trace-abc",
   *     name: "helpfulness",
   *     value: 1,
   *     dataType: "BOOLEAN",
   *   });
   */
  async createScore(params: CreateScoreParams) {
    try {
      return await this.client.score.create(params as never);
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Flush all pending events to the Langfuse API. Required before process
   * exit in short-lived applications (serverless, CLI scripts).
   */
  async flush(): Promise<void> {
    try {
      await this.client.flush();
    } catch (err) {
      normalizeError(err);
    }
  }

  /**
   * Gracefully shut down the OpenTelemetry SDK and flush remaining spans.
   * Call during application teardown.
   */
  async shutdown(): Promise<void> {
    try {
      if (this._sdk) {
        await this._sdk.shutdown();
        this._sdk = null;
      }
      await this.flush();
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const langfuse = new LangfuseService();
export default langfuse;
export { LangfuseClient, LangfuseSpanProcessor, NodeSDK };
