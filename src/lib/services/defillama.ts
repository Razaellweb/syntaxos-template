/**
 * DefiLlama service wrapper (thin shim).
 *
 * DefiLlama provides open DeFi analytics — TVL, protocol metrics, yield
 * pools, stablecoin stats, and more. Fully free and open-source, no API
 * key required. This wrapper uses platform `fetch`.
 *
 * No env vars required.
 *
 * Usage:
 *   import { defillama } from "@/lib/services/defillama";
 *   const protocol = await defillama.getProtocol("aave");
 */

import {
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "defillama";
const BASE_URL = "https://api.llama.fi";
const YIELDS_URL = "https://yields.llama.fi";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class DefiLlamaService {
  private async request<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async getProtocols<T = unknown>(): Promise<T> {
    return this.request<T>(`${BASE_URL}/protocols`);
  }

  async getProtocol<T = unknown>(slug: string): Promise<T> {
    return this.request<T>(`${BASE_URL}/protocol/${slug}`);
  }

  async getTvl(protocol: string): Promise<number> {
    const res = await this.request<number>(`${BASE_URL}/tvl/${protocol}`);
    return res;
  }

  async getChains<T = unknown>(): Promise<T> {
    return this.request<T>(`${BASE_URL}/v2/chains`);
  }

  async getYieldPools<T = unknown>(): Promise<T> {
    return this.request<T>(`${YIELDS_URL}/pools`);
  }

  async getStablecoins<T = unknown>(): Promise<T> {
    return this.request<T>(`${BASE_URL}/stablecoins`);
  }
}

export const defillama = new DefiLlamaService();
export default defillama;
