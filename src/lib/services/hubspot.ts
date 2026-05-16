/**
 * HubSpot service wrapper (thin shim).
 *
 * Wraps the official `@hubspot/api-client` SDK with lazy initialization
 * and normalized error handling. HubSpot provides CRM, marketing, sales,
 * and service APIs.
 *
 * Required env vars:
 *   - HUBSPOT_ACCESS_TOKEN
 *
 * Usage:
 *   import { hubspot } from "@/lib/services/hubspot";
 *   const contact = await hubspot.run((c) =>
 *     c.crm.contacts.basicApi.create({ properties: { email: "user@example.com" } })
 *   );
 */

import { Client } from "@hubspot/api-client";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "hubspot";

function normalizeError(err: unknown): never {
  const e = err as { code?: number; status?: number; statusCode?: number } | null;
  const status = e?.code ?? e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  throw err;
}

export class HubSpotService {
  private _client: Client | null = null;

  get client(): Client {
    if (!this._client) {
      const token = process.env.HUBSPOT_ACCESS_TOKEN;
      if (!token) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: HUBSPOT_ACCESS_TOKEN"),
        );
      }
      this._client = new Client({ accessToken: token });
    }
    return this._client;
  }

  async run<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const hubspot = new HubSpotService();
export default hubspot;
export { Client as HubSpotClient };
