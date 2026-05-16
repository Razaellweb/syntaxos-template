/**
 * CoinGecko service wrapper (thin shim).
 *
 * CoinGecko provides comprehensive cryptocurrency market data for 13,000+
 * coins. No official Node SDK — this wrapper uses platform `fetch` with
 * optional API key for Pro/Demo plans.
 *
 * Optional env vars:
 *   - COINGECKO_API_KEY (for Pro/Demo plans; free tier works without)
 *
 * Usage:
 *   import { coingecko } from "@/lib/services/coingecko";
 *   const price = await coingecko.simplePrice(["bitcoin", "ethereum"], ["usd"]);
 */

import {
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "coingecko";

function getBaseUrl(): string {
  return process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";
}

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class CoinGeckoService {
  private async request<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${getBaseUrl()}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = process.env.COINGECKO_API_KEY;
    if (apiKey) headers["x-cg-pro-api-key"] = apiKey;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async simplePrice<T = unknown>(ids: string[], vsCurrencies: string[]): Promise<T> {
    return this.request<T>("/simple/price", {
      ids: ids.join(","),
      vs_currencies: vsCurrencies.join(","),
    });
  }

  async coinData<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/coins/${id}`);
  }

  async coinMarketChart<T = unknown>(id: string, vsCurrency: string, days: number): Promise<T> {
    return this.request<T>(`/coins/${id}/market_chart`, {
      vs_currency: vsCurrency,
      days: String(days),
    });
  }

  async trending<T = unknown>(): Promise<T> {
    return this.request<T>("/search/trending");
  }
}

export const coingecko = new CoinGeckoService();
export default coingecko;
