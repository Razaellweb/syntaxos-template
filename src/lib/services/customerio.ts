/**
 * Customer.io service wrapper (thin shim).
 *
 * Wraps the official `customerio-node` SDK with lazy initialization and
 * normalized error handling. Customer.io provides behavioral messaging
 * automation — targeted emails, push, SMS, and in-app messages.
 *
 * Required env vars:
 *   - CUSTOMERIO_SITE_ID
 *   - CUSTOMERIO_API_KEY
 * Optional env vars:
 *   - CUSTOMERIO_APP_API_KEY  (for transactional and App API)
 *   - CUSTOMERIO_REGION       ("eu" for EU region; defaults to US)
 *
 * Usage:
 *   import { customerio } from "@/lib/services/customerio";
 *   await customerio.identify("user-1", { email: "user@example.com", plan: "pro" });
 *   await customerio.track("user-1", "purchase", { amount: 49.99 });
 */

import {
  TrackClient,
  APIClient,
  RegionUS,
  RegionEU,
} from "customerio-node";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "customerio";

function normalizeError(err: unknown): never {
  const e = err as { statusCode?: number; status?: number } | null;
  const status = e?.statusCode ?? e?.status;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class CustomerIoService {
  private _track: TrackClient | null = null;
  private _api: APIClient | null = null;

  get trackClient(): TrackClient {
    if (!this._track) {
      const siteId = process.env.CUSTOMERIO_SITE_ID;
      const apiKey = process.env.CUSTOMERIO_API_KEY;
      if (!siteId || !apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: CUSTOMERIO_SITE_ID and/or CUSTOMERIO_API_KEY",
          ),
        );
      }
      const region = process.env.CUSTOMERIO_REGION === "eu" ? RegionEU : RegionUS;
      this._track = new TrackClient(siteId, apiKey, { region });
    }
    return this._track;
  }

  get apiClient(): APIClient {
    if (!this._api) {
      const appKey = process.env.CUSTOMERIO_APP_API_KEY;
      if (!appKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing env var: CUSTOMERIO_APP_API_KEY (needed for App API)"),
        );
      }
      const region = process.env.CUSTOMERIO_REGION === "eu" ? RegionEU : RegionUS;
      this._api = new APIClient(appKey, { region });
    }
    return this._api;
  }

  async identify(id: string, attributes: Record<string, unknown> = {}) {
    try {
      await this.trackClient.identify(id, attributes);
    } catch (err) {
      normalizeError(err);
    }
  }

  async track(id: string, event: string, data: Record<string, unknown> = {}) {
    try {
      await this.trackClient.track(id, { name: event, data });
    } catch (err) {
      normalizeError(err);
    }
  }

  async sendTransactionalEmail(params: {
    transactional_message_id: string;
    to: string;
    identifiers: { id?: string; email?: string };
    message_data?: Record<string, unknown>;
  }) {
    try {
      return await this.apiClient.sendEmail({
        transactional_message_id: params.transactional_message_id,
        to: params.to,
        identifiers: params.identifiers,
        message_data: params.message_data ?? {},
      });
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const customerio = new CustomerIoService();
export default customerio;
