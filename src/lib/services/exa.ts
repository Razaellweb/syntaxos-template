/**
 * Exa service wrapper (thin shim).
 *
 * Wraps the official `exa-js` SDK with lazy initialization and normalized
 * error handling. Exa provides AI-native semantic search that returns
 * clean content from the web optimized for LLM consumption.
 *
 * Required env vars:
 *   - EXA_API_KEY
 *
 * Usage:
 *   import { exa } from "@/lib/services/exa";
 *   const results = await exa.run((c) =>
 *     c.searchAndContents("latest AI research", { numResults: 5 })
 *   );
 */

import Exa from "exa-js";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "exa";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class ExaService {
  private _client: Exa | null = null;

  get client(): Exa {
    if (!this._client) {
      const apiKey = process.env.EXA_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: EXA_API_KEY"),
        );
      }
      this._client = new Exa(apiKey);
    }
    return this._client;
  }

  async run<T>(fn: (client: Exa) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const exa = new ExaService();
export default exa;
export { Exa };
