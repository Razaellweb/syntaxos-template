/**
 * RabbitMQ service wrapper (thin shim).
 *
 * Wraps the `amqplib` client with lazy initialization and normalized error
 * handling. Provides AMQP 0-9-1 messaging with exchanges, queues, and routing.
 *
 * Required env vars:
 *   - RABBITMQ_URL (amqp://user:pass@host:port/vhost)
 *
 * Usage:
 *   import { rabbitmq } from "@/lib/services/rabbitmq";
 *   await rabbitmq.publish("exchange", "routing.key", { event: "user.created" });
 */

import amqplib, { Channel, Connection } from "amqplib";
import {
  ServiceAuthError,
  ServiceError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "rabbitmq";

function normalizeError(err: unknown): never {
  const e = err as { code?: number | string; message?: string } | null;
  if (e?.code === "ACCESS_REFUSED" || e?.message?.includes("ACCESS_REFUSED")) throw new ServiceAuthError(PROVIDER, err);
  throw err;
}

export class RabbitMQService {
  private _connection: Connection | null = null;
  private _channel: Channel | null = null;
  private _connectionPromise: Promise<Connection> | null = null;

  private getUrl(): string {
    const url = process.env.RABBITMQ_URL;
    if (!url) {
      throw new ServiceAuthError(
        PROVIDER,
        new Error("missing required env var: RABBITMQ_URL"),
      );
    }
    return url;
  }

  async connect(): Promise<Connection> {
    if (this._connection) return this._connection;
    if (this._connectionPromise) return this._connectionPromise;
    this._connectionPromise = amqplib.connect(this.getUrl()).then((conn) => {
      this._connection = conn;
      this._connectionPromise = null;
      conn.on("close", () => { this._connection = null; this._channel = null; });
      return conn;
    }).catch((err) => {
      this._connectionPromise = null;
      normalizeError(err);
    });
    return this._connectionPromise;
  }

  async channel(): Promise<Channel> {
    if (this._channel) return this._channel;
    const conn = await this.connect();
    this._channel = await conn.createChannel();
    this._channel.on("close", () => { this._channel = null; });
    return this._channel;
  }

  async publish(exchange: string, routingKey: string, message: unknown) {
    const ch = await this.channel();
    ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  async sendToQueue(queue: string, message: unknown) {
    const ch = await this.channel();
    ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  async close() {
    if (this._channel) await this._channel.close().catch(() => {});
    if (this._connection) await this._connection.close().catch(() => {});
    this._channel = null;
    this._connection = null;
  }
}

export const rabbitmq = new RabbitMQService();
export default rabbitmq;
