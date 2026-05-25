// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const LOG_PREFIX = "[redis]";

function createRedisClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        console.warn(`${LOG_PREFIX} Redis connection lost after ${times} retries. Giving up.`);
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on("connect", () => console.log(`${LOG_PREFIX} Connected to Redis`));
  client.on("ready", () => console.log(`${LOG_PREFIX} Redis ready`));
  client.on("error", (err) => console.error(`${LOG_PREFIX} Error:`, err.message));
  client.on("close", () => console.warn(`${LOG_PREFIX} Connection closed`));
  client.on("reconnecting", () => console.log(`${LOG_PREFIX} Reconnecting...`));

  return client;
}

let client: Redis | null = null;

export async function getRedisClient(): Promise<Redis> {
  if (!client) {
    client = createRedisClient();
    await client.connect().catch((err) => {
      console.error(`${LOG_PREFIX} Failed to connect:`, err.message);
      client = null;
      throw err;
    });
  }
  return client;
}

export async function closeRedisConnection(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    console.log(`${LOG_PREFIX} Connection closed gracefully`);
  }
}

export function isRedisAvailable(): boolean {
  return client !== null && client.status === "ready";
}
