/**
 * AWS SQS service wrapper (thin shim).
 *
 * Wraps the official `@aws-sdk/client-sqs` with lazy initialization and
 * normalized error handling. Provides message queuing with standard and
 * FIFO queues.
 *
 * Required env vars:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION
 *   - AWS_SQS_QUEUE_URL
 *
 * Usage:
 *   import { sqs } from "@/lib/services/aws-sqs";
 *   await sqs.sendMessage({ body: JSON.stringify({ event: "user.created" }) });
 */

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import {
  ServiceAuthError,
  ServiceError,
  ServiceNotFoundError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "aws-sqs";

function normalizeError(err: unknown): never {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = e?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403 || e?.name === "AccessDeniedException") throw new ServiceAuthError(PROVIDER, err);
  if (status === 404 || e?.name === "QueueDoesNotExist") throw new ServiceNotFoundError(PROVIDER, undefined, err);
  if (status === 429 || e?.name === "OverLimit") throw new ServiceRateLimitError(PROVIDER, undefined, err);
  if (e?.name) throw new ServiceError(`[${PROVIDER}] ${e.name}`, PROVIDER, err);
  throw err;
}

export class AwsSqsService {
  private _client: SQSClient | null = null;
  private _queueUrl: string | null = null;

  get client(): SQSClient {
    if (!this._client) {
      const region = process.env.AWS_REGION;
      if (!region) throw new ServiceAuthError(PROVIDER, new Error("missing required env var: AWS_REGION"));
      this._client = new SQSClient({ region });
    }
    return this._client;
  }

  get queueUrl(): string {
    if (!this._queueUrl) {
      this._queueUrl = process.env.AWS_SQS_QUEUE_URL ?? "";
      if (!this._queueUrl) throw new ServiceError(`[${PROVIDER}] missing required env var: AWS_SQS_QUEUE_URL`, PROVIDER);
    }
    return this._queueUrl;
  }

  async sendMessage(params: { body: string; delaySeconds?: number; messageGroupId?: string }) {
    try {
      return await this.client.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: params.body,
        DelaySeconds: params.delaySeconds,
        MessageGroupId: params.messageGroupId,
      }));
    } catch (err) { normalizeError(err); }
  }

  async receiveMessages(maxMessages = 10, waitTimeSeconds = 20) {
    try {
      return await this.client.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
      }));
    } catch (err) { normalizeError(err); }
  }

  async deleteMessage(receiptHandle: string) {
    try {
      return await this.client.send(new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }));
    } catch (err) { normalizeError(err); }
  }
}

export const sqs = new AwsSqsService();
export default sqs;
