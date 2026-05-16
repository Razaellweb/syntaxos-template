/**
 * Mem0 service wrapper (thin shim).
 *
 * Wraps the official `mem0ai` SDK with lazy initialization and normalized
 * error handling. Provides memory layer for AI applications with user,
 * agent, and session-level memory scopes.
 *
 * Required env vars:
 *   - MEM0_API_KEY
 *
 * Usage:
 *   import { mem0 } from "@/lib/services/mem0";
 *   await mem0.run((c) => c.add("User prefers dark mode", { user_id: "user-1" }));
 */

import MemoryClient from "mem0ai";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "mem0";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class Mem0Service {
  private _client: MemoryClient | null = null;

  get client(): MemoryClient {
    if (!this._client) {
      const apiKey = process.env.MEM0_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: MEM0_API_KEY"),
        );
      }
      this._client = new MemoryClient({ apiKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: MemoryClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const mem0 = new Mem0Service();
export default mem0;
export { MemoryClient };
