/**
 * Salesforce service wrapper (thin shim).
 *
 * Wraps the `jsforce` library with lazy initialization and normalized
 * error handling. Salesforce provides enterprise CRM APIs for managing
 * leads, contacts, accounts, opportunities, and custom objects.
 *
 * Required env vars:
 *   - SALESFORCE_INSTANCE_URL
 *   - SALESFORCE_CLIENT_ID
 *   - SALESFORCE_CLIENT_SECRET
 *   - SALESFORCE_REFRESH_TOKEN
 *
 * Usage:
 *   import { salesforce } from "@/lib/services/salesforce";
 *   const results = await salesforce.query("SELECT Id, Name FROM Account LIMIT 10");
 */

import jsforce from "jsforce";
import type { Connection } from "jsforce";
import {
  ServiceAuthError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "salesforce";

function normalizeError(err: unknown): never {
  const e = err as { errorCode?: string; statusCode?: number } | null;
  if (e?.errorCode === "INVALID_SESSION_ID" || e?.statusCode === 401) {
    throw new ServiceAuthError(PROVIDER, err);
  }
  if (e?.errorCode === "NOT_FOUND" || e?.statusCode === 404) {
    throw new ServiceNotFoundError(PROVIDER, undefined, err);
  }
  if (e?.errorCode === "REQUEST_LIMIT_EXCEEDED" || e?.statusCode === 429) {
    throw new ServiceRateLimitError(PROVIDER, undefined, err);
  }
  throw err;
}

export class SalesforceService {
  private _conn: Connection | null = null;
  private _refreshing: Promise<Connection> | null = null;

  private async getConnection(): Promise<Connection> {
    if (this._conn) return this._conn;
    if (this._refreshing) return this._refreshing;

    this._refreshing = (async () => {
      const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
      const clientId = process.env.SALESFORCE_CLIENT_ID;
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
      const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN;

      if (!instanceUrl || !clientId || !clientSecret || !refreshToken) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error(
            "missing required env vars: SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and/or SALESFORCE_REFRESH_TOKEN",
          ),
        );
      }

      const conn = new jsforce.Connection({
        instanceUrl,
        oauth2: { clientId, clientSecret },
        refreshToken,
      });

      this._conn = conn;
      return conn;
    })().finally(() => {
      this._refreshing = null;
    });

    return this._refreshing;
  }

  async run<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    try {
      const conn = await this.getConnection();
      return await fn(conn);
    } catch (err) {
      normalizeError(err);
    }
  }

  async query<T = unknown>(soql: string) {
    return this.run((conn) => conn.query<T>(soql));
  }

  async create(sobject: string, record: Record<string, unknown>) {
    return this.run((conn) => conn.sobject(sobject).create(record));
  }

  async update(sobject: string, record: Record<string, unknown> & { Id: string }) {
    return this.run((conn) => conn.sobject(sobject).update(record));
  }

  async destroy(sobject: string, id: string) {
    return this.run((conn) => conn.sobject(sobject).destroy(id));
  }
}

export const salesforce = new SalesforceService();
export default salesforce;
