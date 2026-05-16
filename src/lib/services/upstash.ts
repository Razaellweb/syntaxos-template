/**
 * Upstash service wrapper (thin shim).
 *
 * Wraps the official `@upstash/redis` SDK with lazy initialization and
 * normalized error handling. Upstash provides serverless Redis with an
 * HTTP-based interface optimized for edge and serverless environments.
 *
 * Required env vars:
 *   - UPSTASH_REDIS_REST_URL
 *   - UPSTASH_REDIS_REST_TOKEN
 *
 * Usage:
 *   import { upstash } from "@/lib/services/upstash";
 *   await upstash.client.set("key", "value");
 *   const val = await upstash.client.get("key");
 */

import { Redis } from "@upstash/redis";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "upstash";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; message?: string } | null;
  if (e?.message?.includes("Unauthorized") || e?.status === 401) throw new ServiceAuthError(PROVIDER, err);
  if (e?.status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class UpstashService {
  private _client: Redis | null = null;

  get client(): Redis {
    if (!this._client) {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env vars: UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN"),
        );
      }
      this._client = new Redis({ url, token });
    }
    return this._client;
  }

  async run<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const upstash = new UpstashService();
export default upstash;
export { Redis };
