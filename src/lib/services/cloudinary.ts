/**
 * Cloudinary service wrapper (thin shim).
 *
 * Wraps the official `cloudinary` SDK (v2) with lazy initialization and
 * normalized error handling. Provides image/video upload, transformation,
 * optimization, and CDN delivery.
 *
 * Required env vars:
 *   - CLOUDINARY_CLOUD_NAME
 *   - CLOUDINARY_API_KEY
 *   - CLOUDINARY_API_SECRET
 *
 * Usage:
 *   import { cloudinary } from "@/lib/services/cloudinary";
 *   const result = await cloudinary.upload("/path/to/image.jpg", { folder: "avatars" });
 */

import { v2 as cloudinarySdk, UploadApiResponse } from "cloudinary";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "cloudinary";

function normalizeError(err: unknown): never {
  const e = err as { http_code?: number; message?: string } | null;
  const status = e?.http_code;
  if (status === 401 || status === 403) throw new ServiceAuthError(PROVIDER, err);
  if (status === 404) throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429) throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.message) throw new ServiceError(`[${PROVIDER}] ${e.message}`, PROVIDER, err);
  throw err;
}

export class CloudinaryService {
  private _configured = false;

  private configure() {
    if (this._configured) return;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and/or CLOUDINARY_API_SECRET"),
      );
    }
    cloudinarySdk.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this._configured = true;
  }

  async upload(file: string, options?: Record<string, unknown>): Promise<UploadApiResponse> {
    this.configure();
    try {
      return await cloudinarySdk.uploader.upload(file, options);
    } catch (err) { normalizeError(err); }
  }

  async destroy(publicId: string, options?: Record<string, unknown>) {
    this.configure();
    try {
      return await cloudinarySdk.uploader.destroy(publicId, options);
    } catch (err) { normalizeError(err); }
  }

  url(publicId: string, options?: Record<string, unknown>): string {
    this.configure();
    return cloudinarySdk.url(publicId, options);
  }

  async resources(options?: Record<string, unknown>) {
    this.configure();
    try {
      return await cloudinarySdk.api.resources(options);
    } catch (err) { normalizeError(err); }
  }
}

export const cloudinary = new CloudinaryService();
export default cloudinary;
export { cloudinarySdk };
