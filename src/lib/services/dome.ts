/**
 * Dome API service wrapper (thin shim).
 *
 * Wraps the official `@dome-api/sdk` with lazy initialization and normalized
 * error handling. Dome provides a unified API for prediction markets data
 * across Polymarket, Kalshi, and other platforms.
 *
 * Required env vars:
 *   - DOME_API_KEY
 *
 * Usage:
 *   import { dome } from "@/lib/services/dome";
 *   const markets = await dome.getMarkets();
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "dome";
const BASE_URL = "https://api.domeapi.io/v1";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class DomeService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.DOME_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: DOME_API_KEY"));
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.getApiKey(),
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

  async getMarkets<T = unknown>(params?: { platform?: string; status?: string }): Promise<T> {
    return this.request<T>("/markets", params as Record<string, string>);
  }

  async getMarket<T = unknown>(marketId: string): Promise<T> {
    return this.request<T>(`/markets/${marketId}`);
  }

  async getCandles<T = unknown>(marketId: string, params?: { interval?: string; start?: string; end?: string }): Promise<T> {
    return this.request<T>(`/markets/${marketId}/candles`, params as Record<string, string>);
  }

  async getWalletActivity<T = unknown>(address: string): Promise<T> {
    return this.request<T>(`/wallets/${address}/activity`);
  }
}

export const dome = new DomeService();
export default dome;
