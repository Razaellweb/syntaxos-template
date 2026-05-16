/**
 * Smile ID service wrapper (thin shim).
 *
 * Wraps the official `smile-identity-core` SDK with lazy initialization
 * and normalized error handling. Provides KYC, biometric verification,
 * and document verification across 50+ African countries.
 *
 * Required env vars:
 *   - SMILE_ID_PARTNER_ID
 *   - SMILE_ID_API_KEY
 * Optional env vars:
 *   - SMILE_ID_SID_SERVER (0 for sandbox, 1 for production; defaults to 0)
 *
 * Usage:
 *   import { smileId } from "@/lib/services/smile-id";
 *   const result = await smileId.verifyId({ ... });
 */

import {
  WebApi,
  IDApi,
} from "smile-identity-core";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "smile-id";

function normalizeError(err: unknown): never {
  const e = err as { status?: number; code?: string; message?: string } | null;
  if (e?.code === "2204" || e?.message?.includes("unauthorized")) throw new ServiceAuthError(PROVIDER, err);
  if (e?.code === "2223") throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (e?.status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.message) throw new ServiceError(`[${PROVIDER}] ${e.message}`, PROVIDER, err);
  throw err;
}

export class SmileIdService {
  private _webApi: WebApi | null = null;
  private _idApi: IDApi | null = null;

  private getConfig() {
    const partnerId = process.env.SMILE_ID_PARTNER_ID;
    const apiKey = process.env.SMILE_ID_API_KEY;
    if (!partnerId || !apiKey) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env vars: SMILE_ID_PARTNER_ID and/or SMILE_ID_API_KEY"),
      );
    }
    const sidServer = process.env.SMILE_ID_SID_SERVER ?? "0";
    return { partnerId, apiKey, sidServer };
  }

  get webApi(): WebApi {
    if (!this._webApi) {
      const { partnerId, apiKey, sidServer } = this.getConfig();
      this._webApi = new WebApi(partnerId, "/tmp", apiKey, Number(sidServer));
    }
    return this._webApi;
  }

  get idApi(): IDApi {
    if (!this._idApi) {
      const { partnerId, apiKey, sidServer } = this.getConfig();
      this._idApi = new IDApi(partnerId, apiKey, Number(sidServer));
    }
    return this._idApi;
  }

  async verifyId(params: {
    country: string;
    id_type: string;
    id_number: string;
    first_name?: string;
    last_name?: string;
    dob?: string;
    partner_params: { job_id: string; user_id: string; job_type: number };
  }) {
    try {
      return await this.idApi.submit_job(params.partner_params, params);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const smileId = new SmileIdService();
export default smileId;
