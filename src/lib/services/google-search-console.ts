/**
 * Google Search Console service wrapper (thin shim).
 *
 * Wraps the official `googleapis` SDK with lazy initialization and normalized
 * error handling. Google Search Console provides search analytics, URL
 * inspection, sitemap management, and site verification APIs.
 *
 * Required env vars:
 *   - GOOGLE_CLIENT_ID
 *   - GOOGLE_CLIENT_SECRET
 *   - GOOGLE_REFRESH_TOKEN
 *
 * Usage:
 *   import { gsc } from "@/lib/services/google-search-console";
 *   const data = await gsc.queryAnalytics("https://example.com", {
 *     startDate: "2024-01-01",
 *     endDate: "2024-01-31",
 *     dimensions: ["query"],
 *   });
 */

import { google, searchconsole_v1 } from "googleapis";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "google-search-console";

function normalizeError(err: unknown): never {
  const e = err as { code?: number; status?: number; message?: string } | null;
  const status = e?.code ?? e?.status;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.message) throw new ServiceError(`[${PROVIDER}] ${e.message}`, PROVIDER, err);
  throw err;
}

export class GoogleSearchConsoleService {
  private _client: searchconsole_v1.Searchconsole | null = null;

  get client(): searchconsole_v1.Searchconsole {
    if (!this._client) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
      if (!clientId || !clientSecret || !refreshToken) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and/or GOOGLE_REFRESH_TOKEN",
          ),
        );
      }
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      this._client = google.searchconsole({ version: "v1", auth: oauth2 });
    }
    return this._client;
  }

  async queryAnalytics(
    siteUrl: string,
    opts: {
      startDate: string;
      endDate: string;
      dimensions?: string[];
      rowLimit?: number;
      startRow?: number;
    },
  ) {
    try {
      const res = await this.client.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: opts.startDate,
          endDate: opts.endDate,
          dimensions: opts.dimensions,
          rowLimit: opts.rowLimit ?? 1000,
          startRow: opts.startRow,
        },
      });
      return res.data;
    } catch (err) {
      normalizeError(err);
    }
  }

  async listSitemaps(siteUrl: string) {
    try {
      const res = await this.client.sitemaps.list({ siteUrl });
      return res.data;
    } catch (err) {
      normalizeError(err);
    }
  }

  async inspectUrl(siteUrl: string, inspectionUrl: string) {
    try {
      const res = await this.client.urlInspection.index.inspect({
        requestBody: { siteUrl, inspectionUrl },
      });
      return res.data;
    } catch (err) {
      normalizeError(err);
    }
  }

  async listSites() {
    try {
      const res = await this.client.sites.list();
      return res.data;
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const gsc = new GoogleSearchConsoleService();
export default gsc;
