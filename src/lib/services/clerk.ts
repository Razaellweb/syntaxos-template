/**
 * Clerk service wrapper (thin shim).
 *
 * Wraps the official `@clerk/clerk-sdk-node` with lazy initialization and
 * normalized error handling. Provides authentication, user management,
 * sessions, and organizations.
 *
 * Required env vars:
 *   - CLERK_SECRET_KEY
 *
 * Usage:
 *   import { clerk } from "@/lib/services/clerk";
 *   const user = await clerk.run((c) => c.users.getUser("user_xxx"));
 */

import { createClerkClient, ClerkClient } from "@clerk/clerk-sdk-node";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "clerk";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; clerkError?: boolean; errors?: { code: string }[] } | null;
  const status = e?.status;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class ClerkService {
  private _client: ClerkClient | null = null;

  get client(): ClerkClient {
    if (!this._client) {
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: CLERK_SECRET_KEY"),
        );
      }
      this._client = createClerkClient({ secretKey });
    }
    return this._client;
  }

  async run<T>(fn: (client: ClerkClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const clerk = new ClerkService();
export default clerk;
