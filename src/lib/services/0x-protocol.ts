/**
 * 0x Protocol service wrapper (thin shim).
 *
 * 0x provides DEX aggregation APIs for best-price token swap routing across
 * multiple liquidity sources. No official Node SDK — this wrapper uses
 * platform `fetch` with the 0x-api-key header.
 *
 * Required env vars:
 *   - ZEROX_API_KEY
 *
 * Usage:
 *   import { zerox } from "@/lib/services/0x-protocol";
 *   const quote = await zerox.getSwapQuote({ sellToken: "ETH", buyToken: "DAI", sellAmount: "1000000000000000000" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "0x-protocol";
const BASE_URL = "https://api.0x.org";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class ZeroXService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.ZEROX_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: ZEROX_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      headers: {
        "0x-api-key": this.getApiKey(),
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

  async getSwapQuote<T = unknown>(params: {
    sellToken: string;
    buyToken: string;
    sellAmount?: string;
    buyAmount?: string;
    takerAddress?: string;
  }): Promise<T> {
    const qs: Record<string, string> = {
      sellToken: params.sellToken,
      buyToken: params.buyToken,
    };
    if (params.sellAmount) qs.sellAmount = params.sellAmount;
    if (params.buyAmount) qs.buyAmount = params.buyAmount;
    if (params.takerAddress) qs.takerAddress = params.takerAddress;
    return this.request<T>("/swap/v1/quote", qs);
  }

  async getSwapPrice<T = unknown>(params: {
    sellToken: string;
    buyToken: string;
    sellAmount?: string;
    buyAmount?: string;
  }): Promise<T> {
    const qs: Record<string, string> = {
      sellToken: params.sellToken,
      buyToken: params.buyToken,
    };
    if (params.sellAmount) qs.sellAmount = params.sellAmount;
    if (params.buyAmount) qs.buyAmount = params.buyAmount;
    return this.request<T>("/swap/v1/price", qs);
  }
}

export const zerox = new ZeroXService();
export default zerox;
