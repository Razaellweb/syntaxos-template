/**
 * Hyperliquid service wrapper (thin shim).
 *
 * Hyperliquid is a high-performance perpetual futures DEX with on-chain
 * orderbook trading. No official SDK — this wrapper uses platform `fetch`
 * against the REST API for info and exchange endpoints.
 *
 * Required env vars:
 *   - HYPERLIQUID_PRIVATE_KEY (wallet private key for signing)
 * Optional env vars:
 *   - HYPERLIQUID_TESTNET (set to "true" for testnet)
 *
 * Usage:
 *   import { hyperliquid } from "@/lib/services/hyperliquid";
 *   const meta = await hyperliquid.info({ type: "meta" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "hyperliquid";

function getBaseUrl(): string {
  return process.env.HYPERLIQUID_TESTNET === "true"
    ? "https://api.hyperliquid-testnet.xyz"
    : "https://api.hyperliquid.xyz";
}

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class HyperliquidService {
  private _privateKey: string | null = null;

  private getPrivateKey(): string {
    if (!this._privateKey) {
      this._privateKey = process.env.HYPERLIQUID_PRIVATE_KEY ?? "";
      if (!this._privateKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: HYPERLIQUID_PRIVATE_KEY"),
        );
      }
    }
    return this._privateKey;
  }

  async info<T = unknown>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${getBaseUrl()}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async exchange<T = unknown>(body: Record<string, unknown>): Promise<T> {
    this.getPrivateKey();
    const res = await fetch(`${getBaseUrl()}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async getAllMids<T = unknown>(): Promise<T> {
    return this.info<T>({ type: "allMids" });
  }

  async getOpenOrders<T = unknown>(user: string): Promise<T> {
    return this.info<T>({ type: "openOrders", user });
  }

  async getUserState<T = unknown>(user: string): Promise<T> {
    return this.info<T>({ type: "clearinghouseState", user });
  }
}

export const hyperliquid = new HyperliquidService();
export default hyperliquid;
