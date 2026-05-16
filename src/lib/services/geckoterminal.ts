/**
 * GeckoTerminal service wrapper (thin shim).
 *
 * GeckoTerminal (by CoinGecko) provides on-chain DEX data including pool
 * discovery, OHLCV charts, trade history, and token info across 100+ chains.
 * No SDK — this wrapper uses platform `fetch` against the public REST API.
 *
 * No env vars required (free public API).
 *
 * Usage:
 *   import { geckoterminal } from "@/lib/services/geckoterminal";
 *   const pool = await geckoterminal.getPool("eth", "0x...");
 */

import {
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "geckoterminal";
const BASE_URL = "https://api.geckoterminal.com/api/v2";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class GeckoTerminalService {
  private async request<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async getPool<T = unknown>(network: string, poolAddress: string): Promise<T> {
    return this.request<T>(`/networks/${network}/pools/${poolAddress}`);
  }

  async getTokenPools<T = unknown>(network: string, tokenAddress: string): Promise<T> {
    return this.request<T>(`/networks/${network}/tokens/${tokenAddress}/pools`);
  }

  async getOhlcv<T = unknown>(
    network: string,
    poolAddress: string,
    timeframe: "day" | "hour" | "minute" = "day",
    aggregate = 1,
  ): Promise<T> {
    return this.request<T>(
      `/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}`,
    );
  }

  async getTrades<T = unknown>(network: string, poolAddress: string): Promise<T> {
    return this.request<T>(`/networks/${network}/pools/${poolAddress}/trades`);
  }

  async getTrendingPools<T = unknown>(network?: string): Promise<T> {
    const path = network
      ? `/networks/${network}/trending_pools`
      : "/networks/trending_pools";
    return this.request<T>(path);
  }
}

export const geckoterminal = new GeckoTerminalService();
export default geckoterminal;
