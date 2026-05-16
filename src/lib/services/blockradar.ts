/**
 * Blockradar service wrapper (thin shim).
 *
 * Blockradar provides stablecoin wallet infrastructure with non-custodial
 * wallet APIs, transaction monitoring, and AML compliance. No official
 * Node SDK — this wrapper uses platform `fetch`.
 *
 * Required env vars:
 *   - BLOCKRADAR_API_KEY
 *
 * Usage:
 *   import { blockradar } from "@/lib/services/blockradar";
 *   const wallet = await blockradar.createWallet({ name: "Treasury" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "blockradar";
const BASE_URL = "https://api.blockradar.co/v1";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class BlockradarService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.BLOCKRADAR_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: BLOCKRADAR_API_KEY"));
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {
      "x-api-key": this.getApiKey(),
      "Content-Type": "application/json",
    };
    const init: RequestInit = { method: opts?.method ?? "GET", headers };
    if (opts?.body) init.body = JSON.stringify(opts.body);

    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      let payload: unknown = "";
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ""); }
      normalizeHttpError(res.status, payload);
    }
    return (await res.json()) as T;
  }

  async createWallet<T = unknown>(data: Record<string, unknown>): Promise<T> {
    return this.request<T>("/wallets", { method: "POST", body: data });
  }

  async getWallet<T = unknown>(walletId: string): Promise<T> {
    return this.request<T>(`/wallets/${walletId}`);
  }

  async listAddresses<T = unknown>(walletId: string): Promise<T> {
    return this.request<T>(`/wallets/${walletId}/addresses`);
  }

  async createAddress<T = unknown>(walletId: string, data?: Record<string, unknown>): Promise<T> {
    return this.request<T>(`/wallets/${walletId}/addresses`, { method: "POST", body: data });
  }

  async getTransactions<T = unknown>(walletId: string): Promise<T> {
    return this.request<T>(`/wallets/${walletId}/transactions`);
  }

  async withdraw<T = unknown>(walletId: string, data: Record<string, unknown>): Promise<T> {
    return this.request<T>(`/wallets/${walletId}/withdraw`, { method: "POST", body: data });
  }
}

export const blockradar = new BlockradarService();
export default blockradar;
