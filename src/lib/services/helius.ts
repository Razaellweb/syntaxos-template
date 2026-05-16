/**
 * Helius service wrapper (thin shim).
 *
 * Wraps the official `helius-sdk` with lazy initialization and normalized
 * error handling. Helius provides Solana-focused RPC, DAS API for compressed
 * NFTs, webhooks, and transaction parsing.
 *
 * Required env vars:
 *   - HELIUS_API_KEY
 *
 * Usage:
 *   import { helius } from "@/lib/services/helius";
 *   const txns = await helius.run((h) => h.parseTransactions({ transactions: ["..."] }));
 */

import { Helius } from "helius-sdk";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "helius";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } } | null;
  const status = e?.status ?? e?.statusCode ?? e?.response?.status;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class HeliusService {
  private _client: Helius | null = null;

  get client(): Helius {
    if (!this._client) {
      const apiKey = process.env.HELIUS_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: HELIUS_API_KEY"),
        );
      }
      this._client = new Helius(apiKey);
    }
    return this._client;
  }

  async run<T>(fn: (client: Helius) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const helius = new HeliusService();
export default helius;
export { Helius };
