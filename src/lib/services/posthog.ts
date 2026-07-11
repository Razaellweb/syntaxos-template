/**
 * PostHog service wrapper (thin shim).
 *
 * Wraps the official `posthog-node` SDK with lazy initialization and
 * normalized error handling. PostHog provides product analytics, session
 * replay, feature flags, and A/B testing.
 *
 * Required env vars:
 *   - POSTHOG_API_KEY
 * Optional env vars:
 *   - POSTHOG_HOST  (defaults to https://us.i.posthog.com)
 *
 * Fire-and-forget contract: `capture()` and `identify()` NEVER throw —
 * a missing key or provider outage must never fail the request that
 * emitted the event. `client` and feature-flag reads still surface
 * normalized errors, since callers depend on their results.
 *
 * Usage:
 *   import { posthog } from "@/lib/services/posthog";
 *   posthog.capture({ distinctId: "user-1", event: "signed_up" });
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

function readApiKey(): string | undefined {
  return process.env.POSTHOG_API_KEY;
}

function readHost(): string {
  return process.env.POSTHOG_HOST || "https://us.i.posthog.com";
}

export class PostHogService {
  private _client: PostHog | null = null;

  get client(): PostHog {
    if (!this._client) {
      const apiKey = readApiKey();
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: POSTHOG_API_KEY"),
        );
      }
      this._client = new PostHog(apiKey, { host: readHost() });
    }
    return this._client;
  }

  /** Fire-and-forget event capture. Never throws; no-ops without a key. */
  capture(params: { distinctId: string; event: string; properties?: Record<string, unknown> }) {
    try {
      if (!readApiKey()) return;
      this.client.capture(params);
    } catch (err) {
      console.warn(`[${PROVIDER}] capture failed (ignored):`, err);
    }
  }

  /** Fire-and-forget identify. Never throws; no-ops without a key. */
  identify(params: { distinctId: string; properties?: Record<string, unknown> }) {
    try {
      if (!readApiKey()) return;
      this.client.identify(params);
    } catch (err) {
      console.warn(`[${PROVIDER}] identify failed (ignored):`, err);
    }
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
