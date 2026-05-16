/**
 * Solana Tracker service wrapper (thin shim).
 *
 * Solana Tracker provides real-time token analytics, new token detection,
 * holder data, and trading signals for SPL tokens on Solana DEXes.
 * No official SDK — this wrapper uses platform `fetch`.
 *
 * Required env vars:
 *   - SOLANA_TRACKER_API_KEY
 *
 * Usage:
 *   import { solanaTracker } from "@/lib/services/solana-tracker";
 *   const token = await solanaTracker.getToken("So11...");
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "solana-tracker";
const BASE_URL = "https://data.solanatracker.io";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class SolanaTrackerService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SOLANA_TRACKER_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SOLANA_TRACKER_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  private async request<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "x-api-key": this.getApiKey(),
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }

  async getToken<T = unknown>(mint: string): Promise<T> {
    return this.request<T>(`/tokens/${mint}`);
  }

  async getTrending<T = unknown>(): Promise<T> {
    return this.request<T>("/tokens/trending");
  }

  async getLatest<T = unknown>(): Promise<T> {
    return this.request<T>("/tokens/latest");
  }

  async getTokenHolders<T = unknown>(mint: string): Promise<T> {
    return this.request<T>(`/tokens/${mint}/holders`);
  }
}

export const solanaTracker = new SolanaTrackerService();
export default solanaTracker;
