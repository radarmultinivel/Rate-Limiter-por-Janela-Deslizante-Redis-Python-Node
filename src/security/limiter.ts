// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import Redis from "ioredis";
import { getRedisClient } from "../config/redis";

export interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  resetTimestamp: number;
  limit: number;
  windowSeconds: number;
}

const SLIDING_WINDOW_LOG_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowSeconds = tonumber(ARGV[2])
  local maxRequests = tonumber(ARGV[3])
  local windowStart = now - windowSeconds * 1000

  redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

  local count = redis.call('ZCARD', key)

  if count >= maxRequests then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local resetTimestamp = now + windowSeconds * 1000
    if #oldest >= 2 then
      resetTimestamp = tonumber(oldest[2]) + windowSeconds * 1000
    end
    return {0, count, resetTimestamp}
  end

  redis.call('ZADD', key, now, tostring(now))
  redis.call('EXPIRE', key, windowSeconds + 1)

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetTimestamp = now + windowSeconds * 1000
  if #oldest >= 2 then
    resetTimestamp = tonumber(oldest[2]) + windowSeconds * 1000
  end

  return {1, count + 1, resetTimestamp}
`;

export class SlidingWindowLogLimiter {
  private readonly prefix = "rate_limit";
  private scriptSha: string | null = null;

  constructor(
    private readonly maxRequests: number,
    private readonly windowSeconds: number,
  ) {}

  async check(hash: string): Promise<RateLimiterResult> {
    let client: Redis;

    try {
      client = await getRedisClient();
    } catch {
      return this.failOpenResult();
    }

    const key = `${this.prefix}:${hash}`;
    const now = Date.now();

    try {
      if (!this.scriptSha) {
        this.scriptSha = await client.script("LOAD", SLIDING_WINDOW_LOG_SCRIPT) as string;
      }

      const sha = this.scriptSha!;

      const result = await client.evalsha(
        sha,
        1,
        key,
        now.toString(),
        this.windowSeconds.toString(),
        this.maxRequests.toString(),
      );

      const arr = result as [number, number, number];
      const [allowed, count, resetTimestamp] = arr;

      if (allowed === 0) {
        return {
          allowed: false,
          remaining: 0,
          resetTimestamp,
          limit: this.maxRequests,
          windowSeconds: this.windowSeconds,
        };
      }

      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - count),
        resetTimestamp,
        limit: this.maxRequests,
        windowSeconds: this.windowSeconds,
      };
    } catch (err) {
      this.scriptSha = null;
      console.error("[limiter] Redis error:", err);
      return this.failOpenResult();
    }
  }

  private failOpenResult(): RateLimiterResult {
    return {
      allowed: true,
      remaining: 1,
      resetTimestamp: Date.now() + this.windowSeconds * 1000,
      limit: this.maxRequests,
      windowSeconds: this.windowSeconds,
    };
  }
}
