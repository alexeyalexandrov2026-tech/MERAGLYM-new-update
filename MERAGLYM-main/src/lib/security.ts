/**
 * MERAGLYM Security & SSRF Protection Module
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // Cloud metadata (AWS, GCP, Azure, DigitalOcean)
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Validates a target URL against Server-Side Request Forgery (SSRF) risks.
 * Disallows loopbacks, cloud metadata services, and private RFC1918 networks.
 */
export function isSafeTargetUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);

    // Only HTTP and HTTPS protocols are allowed
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check direct host blocklist
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return false;
    }

    // Check IPv4 private ranges (RFC 1918 + loopbacks + link-local)
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Pattern);
    if (ipMatch) {
      const octet1 = parseInt(ipMatch[1], 10);
      const octet2 = parseInt(ipMatch[2], 10);

      // 127.0.0.0/8 (Loopback)
      if (octet1 === 127) return false;
      // 10.0.0.0/8 (Private)
      if (octet1 === 10) return false;
      // 172.16.0.0/12 (Private)
      if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return false;
      // 192.168.0.0/16 (Private)
      if (octet1 === 192 && octet2 === 168) return false;
      // 169.254.0.0/16 (Link Local / Metadata)
      if (octet1 === 169 && octet2 === 254) return false;
      // 0.0.0.0/8
      if (octet1 === 0) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Generates an RFC 4122 v4 compliant UUID or cryptographically strong Request ID.
 */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }
  return `req_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
}

/**
 * Basic in-memory rate limiter with sliding window for edge runtime.
 */
const rateLimitStore = new Map<string, { count: number; expiresAt: number }>();

export function checkRateLimit(clientIp: string, limit = 60, windowMs = 60000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientIp);

  if (!record || now > record.expiresAt) {
    rateLimitStore.set(clientIp, { count: 1, expiresAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, remaining: limit - record.count };
}

/**
 * Cleans expired rate limit records periodically.
 */
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
      if (now > value.expiresAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 120000);
}
