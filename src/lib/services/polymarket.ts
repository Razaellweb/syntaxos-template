/**
 * Polymarket service wrapper (thin shim).
 *
 * Wraps the official `@polymarket/clob-client` with lazy initialization and
 * normalized error handling. Polymarket provides prediction market trading
 * via a central limit order book (CLOB) on Polygon.
 *
 * Required env vars:
 *   - POLYMARKET_API_KEY
 *   - POLYMARKET_API_SECRET
 *   - POLYMARKET_PASSPHRASE
 *
 * Usage:
 *   import { polymarket } from "@/lib/services/polymarket";
 *   const markets = await polymarket.run((c) => c.getMarkets());
 */

import { ClobClient } from "@polymarket/clob-client";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "polymarket";
const CLOB_URL = "https://clob.polymarket.com";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class PolymarketService {
  private _client: ClobClient | null = null;

  get client(): ClobClient {
    if (!this._client) {
      const apiKey = process.env.POLYMARKET_API_KEY;
      const secret = process.env.POLYMARKET_API_SECRET;
      const passphrase = process.env.POLYMARKET_PASSPHRASE;
      if (!apiKey || !secret || !passphrase) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and/or POLYMARKET_PASSPHRASE",
          ),
        );
      }
      this._client = new ClobClient(CLOB_URL, 137, undefined, {
        key: apiKey,
        secret,
        passphrase,
      });
    }
    return this._client;
  }

  async run<T>(fn: (client: ClobClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const polymarket = new PolymarketService();
export default polymarket;
export { ClobClient };
