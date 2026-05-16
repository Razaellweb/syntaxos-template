/**
 * PostHog service wrapper (thin shim).
 *
 * Wraps the official `posthog-node` SDK with lazy initialization and
 * normalized error handling. PostHog provides product analytics, session
 * replay, feature flags, and A/B testing.
 *
 * Required env vars:
 *   - NEXT_PUBLIC_POSTHOG_KEY
 * Optional env vars:
 *   - NEXT_PUBLIC_POSTHOG_HOST  (defaults to https://us.i.posthog.com)
 *
 * Usage:
 *   import { posthog } from "@/lib/services/posthog";
 *   posthog.client.capture({ distinctId: "user-1", event: "signed_up" });
 */

import { PostHog } from "posthog-node";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "posthog";

function normalizeError(err: unknown): never {
  const e = err as { status?: number } | null;
  if (e?.status === 401 || e?.status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (e?.status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (e?.status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class PostHogService {
  private _client: PostHog | null = null;

  get client(): PostHog {
    if (!this._client) {
      const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: NEXT_PUBLIC_POSTHOG_KEY"),
        );
      }
      this._client = new PostHog(apiKey, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      });
    }
    return this._client;
  }

  capture(params: { distinctId: string; event: string; properties?: Record<string, unknown> }) {
    this.client.capture(params);
  }

  identify(params: { distinctId: string; properties?: Record<string, unknown> }) {
    this.client.identify(params);
  }

  async isFeatureEnabled(key: string, distinctId: string): Promise<boolean> {
    try {
      return (await this.client.isFeatureEnabled(key, distinctId)) ?? false;
    } catch (err) {
      normalizeError(err);
    }
  }

  async shutdown(): Promise<void> {
    if (this._client) {
      await this._client.shutdown();
      this._client = null;
    }
  }
}

export const posthog = new PostHogService();
export default posthog;
export { PostHog };
