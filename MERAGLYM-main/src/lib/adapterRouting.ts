/**
 * MERAGLYM Adapter Routing
 *
 * Maps a free-form investigation target (plus the catalog node it was launched
 * from) onto an intelligence adapter that is actually deployed.
 *
 * Why a whitelist: jobs are executed asynchronously by the `meraglym-consumer`
 * Worker, which registers a fixed set of adapters and rejects anything else with
 * `ADAPTER_NOT_FOUND`. The UI used to fall back to sending the catalog node's
 * *display name* as the job type (e.g. "OSINT Framework" for a folder node),
 * which could never resolve and left the dossier stuck waiting on a job that had
 * already failed. Routing must therefore only ever emit an id from this list.
 */

/** Jobs are queued, not run in-request: the consumer picks them up after ~5-6s.
 * Poll for at most 30s so a stalled job becomes a visible error rather than an
 * indefinite spinner. */
export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_ATTEMPTS = 15;

export const LIVE_ADAPTER_IDS = [
  "phone_recon",
  "phone_person_correlator",
  "egrul_registry",
  "stix_ingest",
  "holehe_recon",
  "fssp_check",
  "opencti_connector",
  "spiderfoot_meta",
  "crypto_recon",
] as const;

export type AdapterId = (typeof LIVE_ADAPTER_IDS)[number];

export type UnroutableReason = "EMPTY_INPUT" | "NO_MATCHING_ADAPTER";

export interface AdapterRoute {
  adapterId: AdapterId;
  /** Adapter-specific payload. Each adapter reads one named field (`phone`,
   * `inn`, `email`, `address`, `name`) and falls back to `target`. Sending the
   * same value under every key — the previous behaviour — let a validator pass
   * on a value meant for a different adapter, e.g. egrul_registry accepting a
   * person's name because it arrived under `inn`. */
  payload: Record<string, string>;
  /** Whether the adapter came from the input's shape or the catalog node. */
  matchedBy: "input" | "node";
}

export interface UnroutableTarget {
  adapterId: null;
  reason: UnroutableReason;
}

export type RoutingResult = AdapterRoute | UnroutableTarget;

export interface RoutableNode {
  type?: string | null;
  name?: string | null;
}

export function isLiveAdapterId(value: unknown): value is AdapterId {
  return typeof value === "string" && (LIVE_ADAPTER_IDS as readonly string[]).includes(value);
}

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

export function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export function isCryptoAddress(raw: string): boolean {
  const t = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return true; // Ethereum
  if (/^bc1[ac-hj-np-z02-9]{11,71}$/i.test(t)) return true; // Bitcoin bech32
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return true; // Bitcoin legacy
  return false;
}

/** INN: 10 digits (legal entity) or 12 (individual). OGRN: 13 or 15. */
export function isCompanyIdentifier(raw: string): boolean {
  return /^(\d{10}|\d{12}|\d{13}|\d{15})$/.test(raw.trim());
}

export function isPhone(raw: string): boolean {
  const t = raw.trim();
  if (!/^\+?[\d\s()\-]+$/.test(t)) return false;
  const d = digitsOnly(t);
  if (t.startsWith("+")) return d.length >= 10 && d.length <= 15;
  // Bare digits: only an 11-digit Russian number is unambiguous here, since
  // 10/12-digit runs are already claimed by isCompanyIdentifier.
  return d.length === 11 && (d.startsWith("7") || d.startsWith("8"));
}

/** Two or three capitalised words (Cyrillic or Latin) — ФИО / full name. */
export function isPersonName(raw: string): boolean {
  const words = raw.trim().split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((w) => /^[А-ЯЁA-Z][а-яёa-z-]+$/.test(w));
}

function payloadFor(adapterId: AdapterId, target: string): Record<string, string> {
  switch (adapterId) {
    case "phone_recon":
    case "phone_person_correlator":
      return { target, phone: target };
    case "egrul_registry":
      return { target, inn: target };
    case "holehe_recon":
      return { target, email: target };
    case "crypto_recon":
      return { target, address: target };
    case "fssp_check":
      return { target, name: target };
    default:
      return { target };
  }
}

function route(adapterId: AdapterId, target: string, matchedBy: AdapterRoute["matchedBy"]): AdapterRoute {
  return { adapterId, payload: payloadFor(adapterId, target), matchedBy };
}

/**
 * Choose the adapter for a target.
 *
 * The input's shape wins over the catalog node, because the adapter validates a
 * specific shape and would reject a mismatch. Only when the input is ambiguous
 * (a domain, a STIX bundle, a company name) does the node's own adapter id apply.
 * A node that carries no adapter id — every folder, and every plain catalog link —
 * never contributes a job type.
 */
export function resolveAdapterRoute(rawInput: string, node?: RoutableNode | null): RoutingResult {
  const target = (rawInput ?? "").trim();
  if (!target) return { adapterId: null, reason: "EMPTY_INPUT" };

  if (isEmail(target)) return route("holehe_recon", target, "input");
  if (isCryptoAddress(target)) return route("crypto_recon", target, "input");
  if (isCompanyIdentifier(target)) return route("egrul_registry", target, "input");
  if (isPhone(target)) return route("phone_person_correlator", target, "input");
  if (isPersonName(target)) return route("fssp_check", target, "input");

  if (isLiveAdapterId(node?.type)) return route(node.type as AdapterId, target, "node");

  return { adapterId: null, reason: "NO_MATCHING_ADAPTER" };
}
