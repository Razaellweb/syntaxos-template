/**
 * Qdrant service wrapper (thin shim).
 *
 * Wraps the official `@qdrant/js-client-rest` SDK with lazy initialization
 * and normalized error handling. Provides vector similarity search with
 * payload filtering.
 *
 * Required env vars:
 *   - QDRANT_URL
 * Optional env vars:
 *   - QDRANT_API_KEY
 *
 * Usage:
 *   import { qdrant } from "@/lib/services/qdrant";
 *   const results = await qdrant.run((c) => c.search("collection", { vector: [0.1, ...], limit: 10 }));
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "qdrant";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class QdrantService {
  private _client: QdrantClient | null = null;

  get client(): QdrantClient {
    if (!this._client) {
      const url = process.env.QDRANT_URL;
      if (!url) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: QDRANT_URL"),
        );
      }
      const apiKey = process.env.QDRANT_API_KEY;
      this._client = new QdrantClient({ url, apiKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: QdrantClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const qdrant = new QdrantService();
export default qdrant;
export { QdrantClient };
