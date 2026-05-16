/**
 * Relay service wrapper (thin shim).
 *
 * Relay.app is an AI-powered workflow automation platform. This wrapper
 * provides a webhook trigger client for firing Relay workflows
 * programmatically via platform `fetch`. No official SDK.
 *
 * Optional env vars:
 *   - RELAY_WEBHOOK_URL (default webhook URL)
 *
 * Usage:
 *   import { relay } from "@/lib/services/relay";
 *   await relay.triggerWebhook({ event: "invoice.paid", amount: 500 });
 */

import {
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "relay";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class RelayService {
  async triggerWebhook(
    data: Record<string, unknown>,
    webhookUrl?: string,
  ): Promise<void> {
    const url = webhookUrl ?? process.env.RELAY_WEBHOOK_URL;
    if (!url) {
      throw new ServiceError(
        `[${PROVIDER}] no webhook URL provided and RELAY_WEBHOOK_URL not set`,
        PROVIDER,
      );
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
}

export const relay = new RelayService();
export default relay;
