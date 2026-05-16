/**
 * SEMrush service wrapper (thin shim).
 *
 * SEMrush provides SEO and marketing APIs for keyword research, domain
 * analytics, backlink analysis, and competitive intelligence. No official
 * Node SDK — this wrapper uses platform `fetch` with the API key passed
 * as a query parameter per SEMrush API spec.
 *
 * Required env vars:
 *   - SEMRUSH_API_KEY
 *
 * Usage:
 *   import { semrush } from "@/lib/services/semrush";
 *   const data = await semrush.domainOverview("example.com");
 */

import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "semrush";
const BASE_URL = "https://api.semrush.com";

function normalizeHttpError(status: number, payload: unknown): never {
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, payload);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, payload);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, payload);
  throw new ServiceError(`[${PROVIDER}] HTTP ${status}`, PROVIDER, payload);
}

export class SemrushService {
  private _apiKey: string | null = null;

  private getApiKey(): string {
    if (!this._apiKey) {
      this._apiKey = process.env.SEMRUSH_API_KEY ?? "";
      if (!this._apiKey) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: SEMRUSH_API_KEY"),
        );
      }
    }
    return this._apiKey;
  }

  async request<T = string>(params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ ...params, key: this.getApiKey() });
    const res = await fetch(`${BASE_URL}/?${qs.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      normalizeHttpError(res.status, text);
    }
    return (await res.text()) as T;
  }

  async domainOverview(domain: string, database = "us") {
    return this.request({
      type: "domain_ranks",
      domain,
      database,
      export_columns: "Dn,Rk,Or,Ot,Oc,Ad,At,Ac",
    });
  }

  async keywordOverview(phrase: string, database = "us") {
    return this.request({
      type: "phrase_all",
      phrase,
      database,
      export_columns: "Ph,Nq,Cp,Co,Nr",
    });
  }

  async backlinkOverview(target: string) {
    return this.request({
      type: "backlinks_overview",
      target,
      target_type: "root_domain",
      export_columns: "ascore,total,domains_num,urls_num",
    });
  }
}

export const semrush = new SemrushService();
export default semrush;
