/**
 * Pinecone service wrapper (thin shim).
 *
 * Wraps the official `@pinecone-database/pinecone` SDK with lazy
 * initialization and normalized error handling. Provides managed vector
 * database for AI similarity search.
 *
 * Required env vars:
 *   - PINECONE_API_KEY
 *
 * Usage:
 *   import { pinecone } from "@/lib/services/pinecone";
 *   const index = pinecone.client.index("my-index");
 *   await index.upsert([{ id: "1", values: [0.1, 0.2, ...] }]);
 */

import { Pinecone } from "@pinecone-database/pinecone";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "pinecone";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class PineconeService {
  private _client: Pinecone | null = null;

  get client(): Pinecone {
    if (!this._client) {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: PINECONE_API_KEY"),
        );
      }
      this._client = new Pinecone({ apiKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: Pinecone) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const pinecone = new PineconeService();
export default pinecone;
export { Pinecone };
