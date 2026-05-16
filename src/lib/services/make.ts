/**
 * Make (Integromat) service wrapper (thin shim).
 *
 * Make is a visual automation platform. This wrapper provides a webhook
 * trigger client and basic API access for scenario management via
 * platform `fetch`. No official Node SDK.
 *
 * Required env vars (for API):
 *   - MAKE_API_TOKEN
 * Optional env vars:
 *   - MAKE_WEBHOOK_URL (default webhook URL)
 *   - MAKE_ZONE (defaults to "us1")
 *
 * Usage:
 *   import { make } from "@/lib/services/make";
 *   await make.triggerWebhook({ event: "order.placed" });
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "make";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class MakeService {
  private _apiToken: string | null = null;

  private getApiToken(): string {
    if (!this._apiToken) {
      this._apiToken = process.env.MAKE_API_TOKEN ?? "";
      if (!this._apiToken) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: MAKE_API_TOKEN"));
      }
    }
    return this._apiToken;
  }

  private getBaseUrl(): string {
    const zone = process.env.MAKE_ZONE || "us1";
    return `https://${zone}.make.com/api/v2`;
  }

  async triggerWebhook(data: Record<string, unknown>, webhookUrl?: string): Promise<void> {
    const url = webhookUrl ?? process.env.MAKE_WEBHOOK_URL;
    if (!url) {
      throw new ServiceError(`[${PROVIDER}] no webhook URL provided and MAKE_WEBHOOK_URL not set`, PROVIDER);
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
  }

  async listScenarios<T = unknown>(teamId: number): Promise<T> {
    const res = await fetch(`${this.getBaseUrl()}/scenarios?teamId=${teamId}`, {
      headers: { Authorization: `Token ${this.getApiToken()}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }
}

export const make = new MakeService();
export default make;
