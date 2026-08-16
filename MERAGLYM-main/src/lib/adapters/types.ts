/**
 * MERAGLYM Universal Adapter & Intelligence Data Contracts
 */

export type AdapterStatus =
  | "OPERATIONAL"
  | "DEGRADED"
  | "CREDENTIAL_REQUIRED"
  | "UNAVAILABLE"
  | "BLOCKED"
  | "TIMEOUT";

export type JobStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "RETRYING";

export interface SourceProvenance {
  sourceId: string;
  sourceType: string;
  sourceName?: string;
  sourceUrl?: string;
  url?: string;
  adapter: string;
  adapterVersion: string;
  retrievedAt: string;
  observedAt?: string;
  requestId: string;
  verified: boolean;
}

export interface Entity {
  id?: string;
  type: "person" | "company" | "phone" | "email" | "domain" | "ip" | "crypto_wallet" | "vehicle" | "document";
  value: string;
  name?: string;
  attributes?: Record<string, unknown>;
  confidence?: number | null;
}

export interface Observation {
  id?: string;
  entityValue: string;
  entityType: string;
  key: string;
  value: unknown;
  confidence: number | null;
  provenance: SourceProvenance;
  observedAt: string;
}

export interface Relationship {
  sourceEntity: string;
  targetEntity: string;
  relationshipType: string;
  confidence: number | null;
  provenance?: SourceProvenance;
}

export interface AdapterError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface AdapterResult<T = unknown> {
  success: boolean;
  adapter: string;
  adapterVersion: string;
  startedAt: string;
  completedAt: string;
  mode?: "live" | "fallback" | "demo";
  verified: boolean;

  data?: T;
  observations: Observation[];
  entities: Entity[];
  relationships: Relationship[];
  source: SourceProvenance[];

  confidence: number | null;
  error?: AdapterError;
}

export interface AdapterHealth {
  id: string;
  name: string;
  version: string;
  status: AdapterStatus;
  latencyMs?: number;
  lastChecked: string;
  requiredCredentials?: string[];
  lastError?: string;
  category: "cis_registry" | "global_recon" | "cti" | "telecom" | "crypto" | "media";
}

export interface AdapterHealthSummary {
  registered: number;
  operational: number;
  degraded: number;
  credentialRequired: number;
  unavailable: number;
  blocked: number;
  adapters: AdapterHealth[];
}

export interface ExecutionContext {
  requestId: string;
  jobId?: string | number;
  timeoutMs?: number;
  env?: Record<string, unknown>;
}

export interface IntelligenceAdapter<I = unknown, O = unknown> {
  id: string;
  name: string;
  version: string;
  category: AdapterHealth["category"];
  requiredCredentials: string[];

  validate(input: I): Promise<void> | void;
  healthCheck(context?: ExecutionContext): Promise<AdapterHealth>;
  execute(input: I, context: ExecutionContext): Promise<AdapterResult<O>>;
}
