/**
 * MERAGLYM Application Configuration Layer
 * Centralized, typed runtime configuration.
 */

export interface DatabaseConfig {
  provider: "d1" | "postgres" | "sqlite";
  url?: string;
}

export interface JobsConfig {
  enabled: boolean;
  maxConcurrent: number;
  defaultTimeoutMs: number;
  maxRetries: number;
}

export interface SecurityConfig {
  ssrfProtection: boolean;
  rateLimitPerMinute: number;
  maxRequestSizeBytes: number;
  maxPromptLength: number;
}

export interface AppConfig {
  environment: "development" | "staging" | "production";
  version: string;
  demoMode: boolean;
  database: DatabaseConfig;
  jobs: JobsConfig;
  security: SecurityConfig;
  ai: {
    enabled: boolean;
    provider: "workers_ai" | "tactical_core";
    model: string;
  };
}

export function getAppConfig(env?: Record<string, unknown>): AppConfig {
  const isProd = process.env.NODE_ENV === "production" || env?.ENVIRONMENT === "production";
  const demoMode = String(process.env.DEMO_MODE || env?.DEMO_MODE || "false").toLowerCase() === "true";

  return {
    environment: isProd ? "production" : "development",
    version: "2.5.0",
    demoMode,
    database: {
      provider: "d1",
      url: process.env.DATABASE_URL as string | undefined,
    },
    jobs: {
      enabled: true,
      maxConcurrent: Number(process.env.JOB_CONCURRENCY || env?.JOB_CONCURRENCY || 5),
      defaultTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || env?.JOB_TIMEOUT_MS || 30000),
      maxRetries: Number(process.env.JOB_MAX_RETRIES || env?.JOB_MAX_RETRIES || 3),
    },
    security: {
      ssrfProtection: true,
      rateLimitPerMinute: 60,
      maxRequestSizeBytes: 1024 * 1024 * 5, // 5MB
      maxPromptLength: 4000,
    },
    ai: {
      enabled: true,
      provider: env?.AI ? "workers_ai" : "tactical_core",
      model: "@cf/meta/llama-3-8b-instruct",
    },
  };
}
