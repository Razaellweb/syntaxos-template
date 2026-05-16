/**
 * Substreams service wrapper (thin shim).
 *
 * Wraps the `@substreams/core` package with lazy initialization and
 * normalized error handling. Substreams provides composable blockchain
 * data transformation using Rust modules processed in parallel.
 *
 * Required env vars:
 *   - SUBSTREAMS_API_KEY
 *
 * Usage:
 *   import { substreams } from "@/lib/services/substreams";
 *   const token = await substreams.getAuthToken();
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "substreams";
const AUTH_URL = "https://auth.streamingfast.io/v1/auth/issue";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class SubstreamsService {
  private _apiKey: string | null = null;
  private _authToken: { token: string; expiresAt: number } | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SUBSTREAMS_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SUBSTREAMS_API_KEY"),
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

export const substreams = new SubstreamsService();
export default substreams;
