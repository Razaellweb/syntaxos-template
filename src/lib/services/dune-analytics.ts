/**
 * Dune Analytics service wrapper (thin shim).
 *
 * Wraps the official `@duneanalytics/client-sdk` with lazy initialization
 * and normalized error handling. Dune provides SQL-based querying of on-chain
 * data across Ethereum, Polygon, Arbitrum, and more.
 *
 * Required env vars:
 *   - DUNE_API_KEY
 *
 * Usage:
 *   import { dune } from "@/lib/services/dune-analytics";
 *   const results = await dune.run((c) => c.execute({ queryId: 3493826 }));
 */

import { DuneClient } from "@duneanalytics/client-sdk";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "dune-analytics";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class DuneAnalyticsService {
  private _client: DuneClient | null = null;

  get client(): DuneClient {
    if (!this._client) {
      const apiKey = process.env.DUNE_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: DUNE_API_KEY"),
        );
      }
      this._client = new DuneClient(apiKey);
    }
    return this._client;
  }

  async run<T>(fn: (client: DuneClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const dune = new DuneAnalyticsService();
export default dune;
export { DuneClient };
