/**
 * BullMQ service wrapper (thin shim).
 *
 * Wraps the `bullmq` library with lazy initialization and normalized error
 * handling. Provides Redis-based job queues with scheduling, retries,
 * rate limiting, and concurrency control.
 *
 * Required env vars:
 *   - REDIS_URL
 *
 * Usage:
 *   import { bullmq } from "@/lib/services/bullmq";
 *   const queue = bullmq.createQueue("emails");
 *   await queue.add("send-welcome", { userId: "123" });
 */

import { Queue, Worker, QueueEvents, ConnectionOptions } from "bullmq";
import {
  ServiceAuthError,
  ServiceError,
} from "./errors";

const PROVIDER = "bullmq";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
  };
}

export class BullMQService {
  private _connection: ConnectionOptions | null = null;

  get connection(): ConnectionOptions {
    if (!this._connection) {
      const url = process.env.REDIS_URL;
      if (!url) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: REDIS_URL"),
        );
      }
      this._connection = parseRedisUrl(url);
    }
    return this._connection;
  }

  createQueue(name: string, opts?: Record<string, unknown>): Queue {
    return new Queue(name, { connection: this.connection, ...opts });
  }

  createWorker(
    name: string,
    processor: (job: { name: string; data: unknown }) => Promise<unknown>,
    opts?: Record<string, unknown>,
  ): Worker {
    return new Worker(name, processor as Parameters<typeof Worker>[1], {
      connection: this.connection,
      ...opts,
    });
  }

  createQueueEvents(name: string): QueueEvents {
    return new QueueEvents(name, { connection: this.connection });
  }
}

export const bullmq = new BullMQService();
export default bullmq;
export { Queue, Worker, QueueEvents };
