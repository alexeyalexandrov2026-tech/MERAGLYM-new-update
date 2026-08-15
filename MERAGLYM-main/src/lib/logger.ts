/**
 * MERAGLYM Structured Logger
 * Emits JSON logs while redacting sensitive tokens, passwords, and API keys.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  requestId?: string;
  jobId?: string | number;
  adapter?: string;
  event: string;
  message?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: string;
}

const REDACT_KEYS = new Set([
  "password",
  "token",
  "apikey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
  "session",
]);

function sanitizeLogPayload(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj == null) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogPayload(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      result[key] = sanitizeLogPayload(val, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export const logger = {
  log(entry: Omit<LogEntry, "timestamp">) {
    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      data: entry.data ? (sanitizeLogPayload(entry.data) as Record<string, unknown>) : undefined,
    };

    const serialized = JSON.stringify(fullEntry);
    if (entry.level === "error") {
      console.error(serialized);
    } else if (entry.level === "warn") {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  },

  info(event: string, meta: Partial<LogEntry> = {}) {
    this.log({ level: "info", event, ...meta });
  },

  warn(event: string, meta: Partial<LogEntry> = {}) {
    this.log({ level: "warn", event, ...meta });
  },

  error(event: string, meta: Partial<LogEntry> = {}) {
    this.log({ level: "error", event, ...meta });
  },
};
