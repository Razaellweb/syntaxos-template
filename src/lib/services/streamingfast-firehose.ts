/**
 * StreamingFast Firehose service wrapper (thin shim).
 *
 * StreamingFast Firehose provides high-performance blockchain data streaming
 * via gRPC. This wrapper provides a lightweight HTTP/REST fallback client
 * for the Firehose REST gateway. For full gRPC streaming, use the
 * `@substreams/core` package directly.
 *
 * Required env vars:
 *   - STREAMINGFAST_API_KEY
 *
 * Usage:
 *   import { firehose } from "@/lib/services/streamingfast-firehose";
 *   const token = await firehose.getAuthToken();
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "streamingfast-firehose";
const AUTH_URL = "https://auth.streamingfast.io/v1/auth/issue";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class StreamingFastFirehoseService {
  private _apiKey: string | null = null;
  private _authToken: { token: string; expiresAt: number } | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.STREAMINGFAST_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: STREAMINGFAST_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  async getAuthToken(): Promise<string> {
    if (this._authToken && this._authToken.expiresAt > Date.now()) {
      return this._authToken.token;
    }
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.getApiKey() }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    const json = (await res.json()) as { token: string; expires_at: number };
    this._authToken = { token: json.token, expiresAt: json.expires_at * 1000 };
    return json.token;
  }
}

export const firehose = new StreamingFastFirehoseService();
export default firehose;
