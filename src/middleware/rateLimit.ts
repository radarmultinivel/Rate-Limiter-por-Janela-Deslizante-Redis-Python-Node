// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import { Request, Response, NextFunction } from "express";
import { SlidingWindowLogLimiter, RateLimiterResult } from "../security/limiter";
import { hashIp } from "../security/hasher";

export interface RateLimitOptions {
  maxRequests?: number;
  windowSeconds?: number;
}

const DEFAULTS = {
  maxRequests: Number(process.env.DEFAULT_MAX_REQUESTS) || 10,
  windowSeconds: Number(process.env.DEFAULT_WINDOW_SECONDS) || 60,
};

export function rateLimit(options: RateLimitOptions = {}) {
  const maxRequests = options.maxRequests ?? DEFAULTS.maxRequests;
  const windowSeconds = options.windowSeconds ?? DEFAULTS.windowSeconds;

  const limiter = new SlidingWindowLogLimiter(maxRequests, windowSeconds);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = extractIp(req);
    const hashed = hashIp(ip);

    let result: RateLimiterResult;

    try {
      result = await limiter.check(hashed);
    } catch (err) {
      console.error("[rateLimit] Unexpected error, failing open:", err);
      next();
      return;
    }

    res.setHeader("X-RateLimit-Limit", result.limit);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, result.remaining));
    res.setHeader("X-RateLimit-Reset", Math.floor(result.resetTimestamp / 1000));

    if (!result.allowed) {
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again after ${Math.ceil((result.resetTimestamp - Date.now()) / 1000)} seconds.`,
        retryAfter: Math.ceil((result.resetTimestamp - Date.now()) / 1000),
      });
      return;
    }

    next();
  };
}

function extractIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0].split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
