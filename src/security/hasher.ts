// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

import crypto from "node:crypto";

const LOG_PREFIX = "[hasher]";

function getSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret) {
    console.warn(`${LOG_PREFIX} RATE_LIMIT_SECRET not set. Using ephemeral default. Set a strong secret in production.`);
    return "ephemeral-default-secret-do-not-use-in-prod";
  }
  return secret;
}

export function hashIp(ip: string): string {
  const secret = getSecret();
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(ip);
  return hmac.digest("hex");
}
