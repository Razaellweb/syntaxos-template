/**
 * CoinMarketCap service wrapper (thin shim).
 *
 * CoinMarketCap provides cryptocurrency market data, rankings, and metadata
 * for 10,000+ coins. No official Node SDK — this wrapper uses platform
 * `fetch` with the X-CMC_PRO_API_KEY header.
 *
 * Required env vars:
 *   - COINMARKETCAP_API_KEY
 *
 * Usage:
 *   import { coinmarketcap } from "@/lib/services/coinmarketcap";
 *   const listings = await coinmarketcap.listingsLatest({ limit: 10 });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "coinmarketcap";
const BASE_URL = "https://pro-api.coinmarketcap.com";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class CoinMarketCapService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.COINMARKETCAP_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: COINMARKETCAP_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const res = await fetch(url.toString(), {
      headers: {
        "X-CMC_PRO_API_KEY": this.getApiKey(),
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async listingsLatest<T = unknown>(params?: { start?: number; limit?: number; convert?: string }): Promise<T> {
    return this.request<T>("/v1/cryptocurrency/listings/latest", {
      start: String(params?.start ?? 1),
      limit: String(params?.limit ?? 100),
      convert: params?.convert ?? "USD",
    });
  }

  async quotesLatest<T = unknown>(params: { id?: string; slug?: string; symbol?: string }): Promise<T> {
    const qs: Record<string, string> = {};
    if (params.id) qs.id = params.id;
    if (params.slug) qs.slug = params.slug;
    if (params.symbol) qs.symbol = params.symbol;
    return this.request<T>("/v2/cryptocurrency/quotes/latest", qs);
  }

  async globalMetrics<T = unknown>(): Promise<T> {
    return this.request<T>("/v1/global-metrics/quotes/latest");
  }
}

export const coinmarketcap = new CoinMarketCapService();
export default coinmarketcap;
