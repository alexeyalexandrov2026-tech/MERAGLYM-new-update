import { AdapterRegistry } from "./registry";

/**
 * Picks the adapter to run for a node.
 *
 * `Node.type` is a taxonomy tag, not an adapter id — most nodes are folders or
 * plain links, and their `name` is a human label ("OSINT Framework"). Sending
 * either of those as a job type produces an ADAPTER_NOT_FOUND job, so anything
 * that is not a registered adapter id falls back to the universal aggregator.
 */
export function resolveAdapterId(node?: { type?: string | null; name?: string | null } | null): string {
  const type = node?.type;
  if (type && AdapterRegistry.get(type)) return type;
  return "universal_recon";
}

/** True when the string names an adapter this build can actually run. */
export function isKnownAdapterId(id: string): boolean {
  return Boolean(AdapterRegistry.get(id));
}
