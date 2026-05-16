/**
 * Firecrawl service wrapper (thin shim).
 *
 * Wraps the official `@mendable/firecrawl-js` SDK with lazy initialization
 * and normalized error handling. Firecrawl converts web pages to clean
 * markdown for LLM consumption, crawls sites, and extracts structured data.
 *
 * Required env vars:
 *   - FIRECRAWL_API_KEY
 *
 * Usage:
 *   import { firecrawl } from "@/lib/services/firecrawl";
 *   const result = await firecrawl.run((c) =>
 *     c.scrapeUrl("https://example.com", { formats: ["markdown"] })
 *   );
 */

import FirecrawlApp from "@mendable/firecrawl-js";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "firecrawl";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class FirecrawlService {
  private _client: FirecrawlApp | null = null;

  get client(): FirecrawlApp {
    if (!this._client) {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: FIRECRAWL_API_KEY"),
        );
      }
      this._client = new FirecrawlApp({ apiKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: FirecrawlApp) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const firecrawl = new FirecrawlService();
export default firecrawl;
export { FirecrawlApp };
