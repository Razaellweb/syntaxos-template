/**
 * Zapier service wrapper (thin shim).
 *
 * Zapier is a no-code automation platform. This wrapper provides a simple
 * webhook trigger client for firing Zapier Zaps programmatically via
 * platform `fetch`. No official SDK needed.
 *
 * Optional env vars:
 *   - ZAPIER_WEBHOOK_URL (default webhook URL)
 *
 * Usage:
 *   import { zapier } from "@/lib/services/zapier";
 *   await zapier.triggerWebhook({ event: "user.created", userId: "123" });
 */

import {
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "zapier";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class ZapierService {
  async triggerWebhook(
    data: Record<string, unknown>,
    webhookUrl?: string,
  ): Promise<void> {
    const url = webhookUrl ?? process.env.ZAPIER_WEBHOOK_URL;
    if (!url) {
      throw new ServiceError(
        `[${PROVIDER}] no webhook URL provided and ZAPIER_WEBHOOK_URL not set`,
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

export const zapier = new ZapierService();
export default zapier;
