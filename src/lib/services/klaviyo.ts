/**
 * Klaviyo service wrapper (thin shim).
 *
 * Wraps the official `klaviyo-api` SDK with lazy initialization and
 * normalized error handling. Klaviyo provides e-commerce email and SMS
 * marketing automation with event-driven flows and segmentation.
 *
 * Required env vars:
 *   - KLAVIYO_API_KEY
 *
 * Usage:
 *   import { klaviyo } from "@/lib/services/klaviyo";
 *   await klaviyo.trackEvent({
 *     type: "event",
 *     attributes: {
 *       metric: { data: { type: "metric", attributes: { name: "Placed Order" } } },
 *       profile: { data: { type: "profile", attributes: { email: "user@example.com" } } },
 *       properties: { value: 49.99 },
 *     },
 *   });
 */

import { ApiKeySession, EventsApi, ProfilesApi } from "klaviyo-api";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "klaviyo";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number } | null;
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class KlaviyoService {
  private _session: ApiKeySession | null = null;

  private getSession(): ApiKeySession {
    if (!this._session) {
      const apiKey = process.env.KLAVIYO_API_KEY;
      if (!apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: KLAVIYO_API_KEY"),
        );
      }
      this._session = new ApiKeySession(apiKey);
    }
    return this._session;
  }

  get events(): EventsApi {
    return new EventsApi(this.getSession());
  }

  get profiles(): ProfilesApi {
    return new ProfilesApi(this.getSession());
  }

  async trackEvent(data: Parameters<EventsApi["createEvent"]>[0]) {
    try {
      return await this.events.createEvent(data);
    } catch (err) {
      normalizeError(err);
    }
  }

  async upsertProfile(data: Parameters<ProfilesApi["createOrUpdateProfile"]>[0]) {
    try {
      return await this.profiles.createOrUpdateProfile(data);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const klaviyo = new KlaviyoService();
export default klaviyo;
