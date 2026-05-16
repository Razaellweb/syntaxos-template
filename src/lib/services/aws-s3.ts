/**
 * AWS S3 service wrapper (thin shim).
 *
 * Wraps the official `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
 * with lazy initialization and normalized error handling. Provides object
 * storage for files, images, and static assets.
 *
 * Required env vars:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION
 *   - AWS_S3_BUCKET
 *
 * Usage:
 *   import { s3 } from "@/lib/services/aws-s3";
 *   const url = await s3.getPresignedUploadUrl("uploads/photo.jpg");
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "aws-s3";

function normalizeError(err: unknown): never {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = e?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403 || e?.name === "AccessDenied") throw new ServiceAuthError(PROVIDER, err);
  if (status === 404 || e?.name === "NoSuchKey") throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429 || e?.name === "SlowDown") throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.name) throw new ServiceError(`[${PROVIDER}] ${e.name}`, PROVIDER, err);
  throw err;
}

export class AwsS3Service {
  private _client: S3Client | null = null;
  private _bucket: string | null = null;

  get client(): S3Client {
    if (!this._client) {
      const region = process.env.AWS_REGION;
      if (!region) {
        throw new ServiceAuthError(PROVIDER, new Error("missing required env var: AWS_REGION"));
      }
      this._client = new S3Client({ region });
    }
    return this._client;
  }

  get bucket(): string {
    if (!this._bucket) {
      this._bucket = process.env.AWS_S3_BUCKET ?? "";
      if (!this._bucket) {
        throw new ServiceError(`[${PROVIDER}] missing required env var: AWS_S3_BUCKET`, PROVIDER);
      }
    }
    return this._bucket;
  }

  async upload(key: string, body: Buffer | Uint8Array | string, contentType?: string) {
    try {
      return await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    } catch (err) { normalizeError(err); }
  }

  async download(key: string) {
    try {
      return await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) { normalizeError(err); }
  }

  async remove(key: string) {
    try {
      return await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) { normalizeError(err); }
  }

  async list(prefix?: string, maxKeys = 1000) {
    try {
      return await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: maxKeys }),
      );
    } catch (err) { normalizeError(err); }
  }

  async getPresignedUploadUrl(key: string, expiresIn = 3600, contentType?: string) {
    try {
      return await getSignedUrl(
        this.client,
        new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
        { expiresIn },
      );
    } catch (err) { normalizeError(err); }
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600) {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn },
      );
    } catch (err) { normalizeError(err); }
  }
}

export const s3 = new AwsS3Service();
export default s3;
