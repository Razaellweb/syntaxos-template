/**
 * Apache Kafka service wrapper (thin shim).
 *
 * Wraps the `kafkajs` client with lazy initialization and normalized error
 * handling. Provides produce/consume capabilities for event streaming.
 *
 * Required env vars:
 *   - KAFKA_BROKERS (comma-separated list)
 * Optional env vars:
 *   - KAFKA_USERNAME (for SASL auth)
 *   - KAFKA_PASSWORD (for SASL auth)
 *   - KAFKA_CLIENT_ID (defaults to "syntaxos")
 *
 * Usage:
 *   import { kafka } from "@/lib/services/kafka";
 *   const producer = kafka.client.producer();
 */

import { Kafka, KafkaConfig, logLevel } from "kafkajs";
import {
  ServiceAuthError,
  ServiceRateLimitError,
} from "./errors";

const PROVIDER = "kafka";

function normalizeError(err: unknown): never {
  const e = err as { type?: string; message?: string } | null;
  if (e?.type === "SASL_AUTHENTICATION_FAILED") throw new ServiceAuthError(PROVIDER, err);
  throw err;
}

export class KafkaService {
  private _client: Kafka | null = null;

  get client(): Kafka {
    if (!this._client) {
      const brokers = process.env.KAFKA_BROKERS;
      if (!brokers) {
        throw new ServiceAuthError(
          PROVIDER,
          new Error("missing required env var: KAFKA_BROKERS"),
        );
      }
      const config: KafkaConfig = {
        clientId: process.env.KAFKA_CLIENT_ID || "syntaxos",
        brokers: brokers.split(",").map((b) => b.trim()),
        logLevel: logLevel.WARN,
      };
      const username = process.env.KAFKA_USERNAME;
      const password = process.env.KAFKA_PASSWORD;
      if (username && password) {
        config.ssl = true;
        config.sasl = { mechanism: "plain", username, password };
      }
      this._client = new Kafka(config);
    }
    return this._client;
  }

  async run<T>(fn: (client: Kafka) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      normalizeError(err);
    }
  }
}

export const kafka = new KafkaService();
export default kafka;
export { Kafka };
