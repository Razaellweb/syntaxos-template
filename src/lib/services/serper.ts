/**
 * Serper.dev service wrapper (thin shim).
 *
 * Serper provides a fast, affordable Google Search API returning structured
 * results (organic, news, images, maps, shopping). No official SDK — this
 * wrapper uses platform `fetch` with the X-API-KEY header.
 *
 * Required env vars:
 *   - SERPER_API_KEY
 *
 * Usage:
 *   import { serper } from "@/lib/services/serper";
 *   const results = await serper.search({ q: "best coffee shops NYC" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "serper";
const BASE_URL = "https://google.serper.dev";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class SerperService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SERPER_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SERPER_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "X-API-KEY": this.getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async search<T = unknown>(params: { q: string; gl?: string; hl?: string; num?: number }): Promise<T> {
    return this.request<T>("/search", params);
  }

  async news<T = unknown>(params: { q: string; gl?: string; hl?: string; num?: number }): Promise<T> {
    return this.request<T>("/news", params);
  }

  async images<T = unknown>(params: { q: string; gl?: string; num?: number }): Promise<T> {
    return this.request<T>("/images", params);
  }
}

export const serper = new SerperService();
export default serper;
