// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import { SlidingWindowLogLimiter } from "../src/security/limiter";
import { hashIp } from "../src/security/hasher";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis;

beforeAll(async () => {
  process.env.RATE_LIMIT_SECRET = "test-secret-for-vitest";
  redis = new Redis(REDIS_URL);
  await redis.ping();
});

afterAll(async () => {
  await redis.quit();
});

async function cleanup(hash: string) {
  await redis.del(`rate_limit:${hash}`);
}

describe("SlidingWindowLogLimiter", () => {
  it("should allow requests within the limit", async () => {
    const ip = "192.168.1.1";
    const hashed = hashIp(ip);
    await cleanup(hashed);

    const limiter = new SlidingWindowLogLimiter(10, 60);

    for (let i = 0; i < 10; i++) {
      const result = await limiter.check(hashed);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it("should block requests exceeding the limit", async () => {
    const ip = "192.168.1.2";
    const hashed = hashIp(ip);
    await cleanup(hashed);

    const limiter = new SlidingWindowLogLimiter(10, 60);

    const allowed: boolean[] = [];

    for (let i = 0; i < 15; i++) {
      const result = await limiter.check(hashed);
      allowed.push(result.allowed);
    }

    const allowedCount = allowed.filter(Boolean).length;
    const blockedCount = allowed.filter((a) => !a).length;

    expect(allowedCount).toBe(10);
    expect(blockedCount).toBe(5);
  });

  it("should return correct remaining count", async () => {
    const ip = "192.168.1.3";
    const hashed = hashIp(ip);
    await cleanup(hashed);

    const limiter = new SlidingWindowLogLimiter(5, 60);

    const r1 = await limiter.check(hashed);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);

    const r2 = await limiter.check(hashed);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);
  });

  it("should return reset timestamp in the future", async () => {
    const ip = "192.168.1.4";
    const hashed = hashIp(ip);
    await cleanup(hashed);

    const limiter = new SlidingWindowLogLimiter(3, 60);
    const result = await limiter.check(hashed);

    expect(result.allowed).toBe(true);
    expect(result.resetTimestamp).toBeGreaterThan(Date.now());
  });

  it("should handle different IPs independently", async () => {
    const ip1 = "10.0.0.1";
    const ip2 = "10.0.0.2";
    const hashed1 = hashIp(ip1);
    const hashed2 = hashIp(ip2);
    await cleanup(hashed1);
    await cleanup(hashed2);

    const limiter = new SlidingWindowLogLimiter(1, 60);

    const r1 = await limiter.check(hashed1);
    expect(r1.allowed).toBe(true);

    const r2 = await limiter.check(hashed2);
    expect(r2.allowed).toBe(true);

    const r1b = await limiter.check(hashed1);
    expect(r1b.allowed).toBe(false);

    const r2b = await limiter.check(hashed2);
    expect(r2b.allowed).toBe(false);
  });
});

describe("Concurrent stress test", () => {
  it("should exactly allow 10 out of 15 concurrent requests for same IP", async () => {
    const ip = "10.0.0.100";
    const hashed = hashIp(ip);
    await cleanup(hashed);

    const limiter = new SlidingWindowLogLimiter(10, 60);

    const promises = Array.from({ length: 15 }, () => limiter.check(hashed));
    const results = await Promise.all(promises);

    const allowed = results.filter((r) => r.allowed).length;
    const blocked = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(10);
    expect(blocked).toBe(5);
  });
});

describe("Fail-open behavior", () => {
  it("should allow request when Redis is unavailable (fail-open)", async () => {
    const originalUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:16379";

    const limiter = new SlidingWindowLogLimiter(10, 60);
    const hashed = hashIp("fail-test");

    const result = await limiter.check(hashed);
    expect(result.allowed).toBe(true);

    process.env.REDIS_URL = originalUrl;
  });
});

describe("hashIp", () => {
  it("should produce deterministic hashes for the same IP", () => {
    const h1 = hashIp("192.168.1.1");
    const h2 = hashIp("192.168.1.1");
    expect(h1).toBe(h2);
  });

  it("should produce different hashes for different IPs", () => {
    const h1 = hashIp("192.168.1.1");
    const h2 = hashIp("192.168.1.2");
    expect(h1).not.toBe(h2);
  });

  it("should produce a 64-char hex string", () => {
    const hash = hashIp("10.0.0.1");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
