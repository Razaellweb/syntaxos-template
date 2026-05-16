/**
 * DexScreener service wrapper (thin shim).
 *
 * DexScreener provides real-time DEX token pair data, prices, and liquidity
 * info across all major chains. No official SDK — this wrapper uses platform
 * `fetch` against the public REST API.
 *
 * Optional env vars:
 *   - DEXSCREENER_API_KEY (for higher rate limits)
 *
 * Usage:
 *   import { dexscreener } from "@/lib/services/dexscreener";
 *   const pairs = await dexscreener.getTokenPairs("solana", "So11...");
 */

import {
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "dexscreener";
const BASE_URL = "https://api.dexscreener.com";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class DexScreenerService {
  private async request<T = unknown>(path: string): Promise<T> {
    const headers: Record<string, string> = {};
    const apiKey = process.env.DEXSCREENER_API_KEY;
    if (apiKey) headers["X-API-KEY"] = apiKey;

    const res = await fetch(`${BASE_URL}${path}`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async getTokenPairs<T = unknown>(chainId: string, tokenAddress: string): Promise<T> {
    return this.request<T>(`/tokens/v1/${chainId}/${tokenAddress}`);
  }

  async getPairsByAddress<T = unknown>(chainId: string, pairAddress: string): Promise<T> {
    return this.request<T>(`/pairs/v1/${chainId}/${pairAddress}`);
  }

  async searchPairs<T = unknown>(query: string): Promise<T> {
    return this.request<T>(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  }

  async getLatestTokenProfiles<T = unknown>(): Promise<T> {
    return this.request<T>("/token-profiles/latest/v1");
  }

  async getTopBoostedTokens<T = unknown>(): Promise<T> {
    return this.request<T>("/token-boosts/top/v1");
  }
}

export const dexscreener = new DexScreenerService();
export default dexscreener;
